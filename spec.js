
var seconds_per_window = 0.5
var slices_per_second = 12
var num_frequencies = 256
var hmin = -40, hmax = 32

// Global contexts
var info = new Infopter()

info.progress("Creating webGL context")
var glcanvas = document.createElement("canvas")
var gl = UFX.gl(glcanvas)
if (gl) {
	info.progress("Creating webGL context", 1)
} else {
	info.error("Unable to get webGL context! Please visit http://get.webgl.org")
}

info.progress("Creating Web Audio context")
var acontext = new AudioContext()
if (acontext) {
	info.progress("Creating Web Audio context", 1)
} else {
	info.error("Unable to create Web Audio context!")
}

var canvas2d = document.createElement("canvas")
var context2d = canvas2d.getContext("2d")
document.body.appendChild(canvas2d)
UFX.draw.setcontext(context2d)
UFX.maximize.onadjust = function (canvas, x, y) {
	var b = 20, h = Math.round(0.6 * y), w = Math.round(0.5 * x)
	info.position(x - w + b, b, w - 2 * b, h - 2 * b)
}
UFX.maximize.fill(canvas2d, "total")

window.onerror = function (error, url, line) {
    document.body.innerHTML = "<p>Error in: "+url+"<p>line "+line+"<pre>"+error+"</pre>"
}
// adds the given event handler and returns a function to remove the event listener.
function addhandler(obj, eventname, handler, capture) {
	capture = capture || false
	obj.addEventListener(eventname, handler, capture)
	return function () {
		obj.removeEventListener(eventname, handler, capture)
	}
}

function loadshaders(shadertext, audiopter) {
	var shaders = {}
	var shader
	shadertext.split("\n").forEach(function (line) {
		if (line.indexOf(">>>") == 0) {
			shader = shaders[line.slice(4)] = []
		} else {
			shader.push(line + "\n")
		}
	})
	for (var s in shaders) {
		shaders[s] = shaders[s].join("")
			.replace("$C$", "" + audiopter.C)
			.replace("$P$", "" + audiopter.P)
	}
	function addprog(name) {
		let vsource = shaders.uniforms + shaders.functions + shaders.vfill
		let fsource = "precision highp float;\n" + shaders.uniforms + shaders.functions + shaders["f" + name]
		gl.addProgram(name, vsource, fsource)
	}
	addprog("dump")
	addprog("chunk")
	addprog("spec")
}

// convert a float sample to and from a usample (unsigned 8-bit int sample)
function tousample(x) {
	x = Math.round((x + 1) * 127.5)
	return x < 0 ? 0 : x > 255 ? 255 : x
}
function fromusample(u) {
	return u / 127.5 + 1
}
// Merge the channels of a buffer into a single (mono) Float32Array
function mergechannels (buffer) {
	var channeldata = [], nchannels = buffer.numberOfChannels
	for (var i = 0 ; i < nchannels ; ++i) {
		channeldata.push(buffer.getChannelData(i))
	}
	var N = channeldata[0].length
	var mergeddata = new Float32Array(N)
	for (var i = 0 ; i < nchannels ; ++i) {
		for (var j = 0 ; j < N ; ++j) {
			mergeddata[j] += channeldata[i][j]
		}
	}
	for (var j = 0 ; j < N ; ++j) {
		mergeddata[j] /= nchannels
	}
	return mergeddata
}
// Create an unsigned byte texture with the given size and format
function makedatatexture(w, h, format) {
	var texture = gl.createTexture()
	gl.bindTexture(gl.TEXTURE_2D, texture)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
	gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, null)
	texture.w = w
	texture.h = h
	return texture
}

function Scape(w, h) {
	this.fbo = gl.createFramebuffer()
	this.texture = makedatatexture(w, h, gl.RGBA)
	this.w = w
	this.h = h
}
Scape.prototype = {
	bind: function () {
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
		gl.bindTexture(gl.TEXTURE_2D, this.texture)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0)
		gl.viewport(0, 0, this.texture.w, this.texture.h)
	},
	unbind: function () {
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
	},
	destroy: function () {
		gl.deleteTexture(this.texture)
		gl.deleteFramebuffer(this.fbo)
	},
}


// FBOs, textures, and programs related to rendering the spectrogram
function Spectropter() {
	this.started = false
}
Spectropter.prototype = {
	init: function (audiopter) {
		if (this.started) this.reset()
		this.audiopter = audiopter
		loadshaders(UFX.resource.data.shaders, audiopter)
		this.rawtexture = makedatatexture(audiopter.C, audiopter.P, gl.LUMINANCE)
		this.chunkscape = new Scape(audiopter.P, num_frequencies)
		this.specscape = new Scape(64, num_frequencies)
		this.nslice = Math.ceil(audiopter.t * slices_per_second)
		this.jslice = 0
		this.jslice0 = 0
		this.extracts = []
		this.started = true
		this.done = false
		info.progress("Generating spectrogram")
	},
	reset: function () {
		this.started = false
		gl.deleteTexture(this.rawtexture)
		this.chunkscape.destroy()
		this.specscape.destroy()
		delete this.extracts
	},
	killtime: function (dt) {
		if (this.done) return
		var end = Date.now() + 1000 * (dt || 0)
		while (!this.done && Date.now() <= end) {
			if (this.jslice == this.specscape.w) {
				this.extracts.push(this.extractspec())
				this.clearspec()
				this.jslice0 += this.specscape.w
				this.jslice = 0
				this.done = this.jslice0 >= this.nslice
			} else {
				this.drawslice()
				this.jslice++
			}
		}
		var f = (this.jslice + this.jslice0) / this.nslice
		info.progress("Generating spectrogram", this.done ? 1 : f)
	},
	drawslice: function () {
		var t0 = (this.jslice + this.jslice0) / slices_per_second
		this.fillrawtexture(t0)
		this.renderchunks()
		this.renderslice(this.jslice)
	},
	drawslices: function () {
		for (var jslice = 0 ; jslice < this.specscape.w ; ++jslice) {
			if (jslice / slices_per_second > this.audiopter.t) break
			this.drawslice(jslice)
		}
	},
	fillrawtexture: function (t0) {
		gl.bindTexture(gl.TEXTURE_2D, this.rawtexture)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.rawtexture.w, this.rawtexture.h, 0,
			gl.LUMINANCE, gl.UNSIGNED_BYTE, this.audiopter.getsamples(t0))
	},
	bindtexture: function (texture) {
		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.prog.set.texture(0)
		gl.prog.set.texturesize([texture.w, texture.h])
	},
	setviewportsize: function (w, h, x0, y0) {
		gl.viewport((x0 || 0), (y0 || 0), w, h)
		gl.prog.set.viewportsize([w, h])
	},
	renderchunks: function () {
		this.chunkscape.bind()
		gl.clear(gl.COLOR_BUFFER_BIT)
		gl.progs.chunk.use()
		this.bindtexture(this.rawtexture)
		this.setviewportsize(this.chunkscape.w, this.chunkscape.h)
		gl.progs.chunk.set({
			hmin: hmin,
			hmax: hmax,
			F: this.audiopter.F,
		})
		gl.drawArrays(gl.POINTS, 0, 1)
		this.chunkscape.unbind()
	},
	clearspec: function () {
		this.specscape.bind()
		gl.clearColor(0, 0, 0, 1)
		gl.clear(gl.COLOR_BUFFER_BIT)
		this.specscape.unbind()
	},
	renderslice: function (x) {
		this.specscape.bind()
		gl.progs.spec.use()
		this.bindtexture(this.chunkscape.texture)
		gl.scissor(x, 0, 1, this.specscape.h)
		this.setviewportsize(1, this.specscape.h, x, 0)
		gl.enable(gl.SCISSOR_TEST)
		gl.progs.spec.set({
		})
		gl.drawArrays(gl.POINTS, 0, 1)
		gl.disable(gl.SCISSOR_TEST)
		this.specscape.unbind()
	},
	extractspec: function () {
        var scanvas = document.createElement("canvas")
        scanvas.width = this.specscape.w
        scanvas.height = this.specscape.h
        var scontext = scanvas.getContext("2d")
		var idata = scontext.createImageData(this.specscape.w, this.specscape.h)
		var pixels = new Uint8Array(idata.data.buffer)
		this.specscape.bind()
		gl.readPixels(0, 0, this.specscape.w, this.specscape.h, gl.RGBA, gl.UNSIGNED_BYTE,
			pixels)
		this.specscape.unbind()
        scontext.putImageData(idata, 0, 0)
        return scanvas
	},
	fillRect: function (x, y, w, h) {
		UFX.draw("[ tr", x, y, w, h, "clip fs black fr", x, y, w, h, "t", x, y + h,
			"z", w / this.nslice, h / this.specscape.h, "vflip")
		this.extracts.forEach(function (extract, j) {
			UFX.draw("drawimage", extract, j * extract.width, 0)
		})
		UFX.draw("]")
	},
	fillRectZoom: function (x, y, w, h, t0, tscale) {
		var zx = tscale / slices_per_second, zy = h / this.specscape.h
		UFX.draw("[ tr", x, y, w, h, "clip fs black fr", x, y, w, h, "t", x + w/2, y + h,
			"z", zx, zy, "vflip t", -t0 * slices_per_second, 0)
		this.extracts.forEach(function (extract, j) {
			UFX.draw("drawimage", extract, j * extract.width, 0)
		})
		UFX.draw("]")
	},
}
function dumptexture(texture) {
	document.body.appendChild(glcanvas)
	gl.resize(texture.w, texture.h)
	gl.clearColor(0, 0, 0, 1)
	gl.clear(gl.COLOR_BUFFER_BIT)
	gl.disable(gl.DEPTH_TEST)
	gl.progs.dump.use()
	gl.activeTexture(gl.TEXTURE0)
	gl.bindTexture(gl.TEXTURE_2D, texture)
	gl.progs.dump.set({
		texture: 0,
		texturesize: [texture.w, texture.h],
		viewportsize: [texture.w, texture.h],
	})
	gl.drawArrays(gl.POINTS, 0, 1)
}

// Buffers related to an audio clip.
//   buffer0: the raw AudioBuffer of the clip
//   F0, N0: sample rate and number of samples in buffer0
//   array0: samples of buffer0 merged to mono
//   uarray: usamples
//   uj0: number of zero samples at each end of uarray
//   F: sample rate of uarray
//   N: number of usamples (counting the bookends)
function Audiopter() {
	this.started = false
	this.hremove = {}
}
Audiopter.prototype = {
	ondone: function () {
	},
	upload: function (file) {
		if (this.started) {
			this.stop()
			this.clearhandlers()
		}
		var reader = new FileReader()
		info.progress("Uploading file")
		this.hremove.progress = addhandler(reader, "progress", this.onreaderprogress.bind(this))
		this.hremove.load = addhandler(reader, "load", this.onreaderload.bind(this))
		reader.readAsArrayBuffer(file)
		this.started = true
		this.done = false
	},
	clearhandlers: function () {
		for (var s in this.hremove) this.hremove[s]()
		this.hremove = {}
	},
	onreaderprogress: function (event, filename) {
		if (event.lengthComputable) {
			var f = event.loaded / event.total
			info.progress("Uploading file", f)
		}
	},
	onreaderload: function (event) {
		this.clearhandlers()
		info.progress("Uploading file", 1)
		info.progress("Decoding audio")
		acontext.decodeAudioData(event.target.result, this.handledecode.bind(this))
	},
	handledecode: function (buffer) {
		info.progress("Decoding audio", 1)
		this.buffer0 = buffer
		this.F0 = buffer.sampleRate
		this.N0 = this.buffer0.getChannelData(0).length
		this.t = this.N0 / this.F0
		this.F = this.F0
		this.setW()
		info.info("Audio sample rate: " + Math.round(this.F0) + "Hz")
		info.info("Audio duration: " + this.t.toFixed(1) + "s")
		info.progress("Resampling audio")
		this.tstop = 0
		setTimeout(this.resample.bind(this), 10)
	},
	resample: function () {
		this.array0 = mergechannels(this.buffer0)
		this.makeuarray()
		info.progress("Resampling audio", 1)
		this.done = true
		this.ondone()
	},
	setW: function () {
		var Wbase = this.F * seconds_per_window
		this.C = 1 << Math.floor(Math.log(Wbase * 2) / Math.log(4))
		this.P = Math.round(Wbase / this.C)
		this.W = this.C * this.P
		this.samples_per_chunk = this.C
		this.chunks_per_window = this.P
		this.samples_per_window = this.W
	},
	makeuarray: function () {
		var j0 = this.uj0 = this.W + 2
		var N = this.N0 * this.F / this.F0
		this.N = N + 2 * this.uj0
		this.uarray = new Uint8Array(this.N)
		if (N == this.N0) {
			for (var j = 0 ; j < N ; ++j) {
				this.uarray[j + j0] = tousample(this.array0[j])
			}
		} else {
			for (var j = 0 ; j < N ; ++j) {
				var kf = j * this.F / this.F0
				var k = Math.floor(kf), f = kf - f
				var x = k < this.N0 - 1 ? (1 - f) * this.array0[k] + f * this.array0[k + 1] : 0
				this.uarray[j + j0] = tousample(x)
			}
		}
	},
	// Get a length-W subarray of usamples centered at time t0
	getsamples: function (t0) {
		var j0 = Math.round(this.uj0 + this.F * t0 - this.W / 2)
		j0 = j0 < 0 ? 0 : j0 >= this.N - this.W ? this.N - this.W - 1 : j0
		return this.uarray.subarray(j0, j0 + this.W)
	},
	settime: function (t) {
		this.tstop = t
	},
	play: function () {
		if (this.source) this.stop()
		this.source = acontext.createBufferSource()
		this.source.buffer = this.buffer0
		this.source.connect(acontext.destination)
		this.source.start(0, this.tstop)
		this.tstart = acontext.currentTime - this.tstop
	},
	stop: function () {
		if (!this.source) return
		this.source.stop()
		this.source.disconnect()
		this.tstop = this.currentTime()
		delete this.source
	},
	currentTime: function () {
		if (!this.source) return this.tstop
		return acontext.currentTime - this.tstart
	},
	currentFraction: function () {
		return this.currentTime() / this.t
	},
}

function FileCatcher() {
	this.reset()
	canvas2d.addEventListener("dragover", this.ondragover.bind(this), false)
	canvas2d.addEventListener("dragenter", this.ondragenter.bind(this), false)
	canvas2d.addEventListener("dragleave", this.ondragleave.bind(this), false)
	canvas2d.addEventListener("drop", this.ondrop.bind(this))
	this.input = document.createElement("input")
	this.input.type = "file"
	this.input.style.position = "absolute"
	this.input.style.border = "none"
	this.input.style.padding = 0
	this.input.style.opacity = 0
	this.input.style.fontSize = "1px"
	this.input.addEventListener("change", this.onselect.bind(this), false)
	document.body.appendChild(this.input)
}
FileCatcher.prototype = {
	oncatch: function (file) {
	},
	position: function (x, y, w, h) {
		this.input.style.left = x + "px"
		this.input.style.top = y + "px"
		this.input.style.width = w + "px"
		this.input.style.height = h + "px"
	},
	reset: function () {
		this.caught = false
		this.focused = false
	},
	draw: function () {
		if (!this.focused) return
		var color = this.focused ? "white" : "#666"
		var h = Math.round(canvas2d.width / 14)
		UFX.draw("[ alpha 0.15 fs", color, "f0",
			"alpha 0.6 t", canvas2d.width/2, canvas2d.height/2,
			"font", h + "px~'Bubblegum~Sans'",
			"fs black sh white -2 -2 0 tab center middle",
			"ft0 Drop~audio~file ]")
	},
	cancel: function (event) {
		event.preventDefault()
		return false
	},
	ondrop: function (event) {
		this.onopen(event.dataTransfer.files)
		return this.cancel(event)
	},
	onselect: function (event) {
		this.onopen(event.target.files)
		return this.cancel(event)
	},
	onopen: function (files) {
		if (files.length != 1) {
			info.error("Please upload exactly 1 file.")
			return this.cancel(event)
		}
		info.clear()
		this.focused = false
		this.caught = true
		spectropter.started = false
		info.info("File name: " + files[0].name)
		this.oncatch(files[0])
	},
	ondragover: function (event) {
		return this.cancel(event)
	},
	ondragenter: function (event) {
		this.focused = true
		return this.cancel(event)
	},
	ondragleave: function (event) {
		this.focused = false
		return this.cancel(event)
	},
}

