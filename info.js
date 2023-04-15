function Infopter() {
	this.box = document.createElement("textarea")
	document.body.appendChild(this.box)
	this.box.style.position = "absolute"
	this.box.style.border = "4px blue outset"
	this.box.style.padding = "6px"
	this.box.style.color = "#07F"
	this.box.style.background = "#002"
	this.box.style.font = "22px bold 'VT323', monospace"
	this.clear()
}
Infopter.prototype = {
	clear: function () {
		this.ps = {}
		this.plist = []
		this.errors = []
	},
	progress: function (pname, f) {
		if (this.plist.indexOf(pname) < 0) this.plist.push(pname)
		this.ps[pname] = f
	},
	info: function (text) {
		this.plist.push(text)
	},
	error: function (err) {
		this.errors.push(err)
	},
	think: function () {
		var lines = []
		for (var j = 0 ; j < this.plist.length ; ++j) {
			var pname = this.plist[j]
			if (pname in this.ps) {
				var f = this.ps[pname]
				var pinfo = !f ? "" : f >= 1 ? "Done" : Math.round(100 * f) + "%"
				lines.push(pname + "... " + pinfo)
			} else {
				lines.push(pname)
			}
		}
		this.errors.forEach(function (err) {
			lines.push("ERROR: " + err)
		})
		this.box.textContent = lines.join("\n")
		if (this.errors.length) {
			this.box.style.borderColor = Date.now() / 1000 % 2 > 1 ? "red" : "blue"
		}
	},
	position: function (x, y, w, h) {
		this.box.style.left = x + "px"
		this.box.style.top = y + "px"
		this.box.style.width = w - 20 + "px"
		this.box.style.height = h - 20 + "px"
		var f = Math.min(Math.round(h / 12), Math.round(w / 18))
		this.box.style.fontSize = f + "px"
	},
}

