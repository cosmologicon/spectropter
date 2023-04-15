>>> uniforms

uniform vec2 viewportsize;
uniform sampler2D texture;
uniform vec2 texturesize;
uniform float hmin, hmax;
uniform float F;

const float tau = 6.283185307179586;
const int C = $C$;
const int P = $P$;

>>> functions

// Blackman window function: 0 <= g <= 1
float window(in float g) {
	return 21.0 - 25.0 * cos(tau * g) + 4.0 * cos(2.0 * tau * g);
}

vec2 toshort(in float x) {
	x = clamp(floor((x + 1.0) / 2.0 * 65535.0), 0.0, 65535.0);
	float a = floor(x / 256.0);
	return vec2(x - 256.0 * a, a) / 255.0;
}
float fromshort(in vec2 a) {
	float x = 255.0 * (a.x + 256.0 * a.y);
	return (x / 65535.0) * 2.0 - 1.0;
}


>>> vfill

void main() {
	gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
	gl_PointSize = max(viewportsize.x, viewportsize.y);
}


>>> fdump

void main() {
	gl_FragColor = vec4(texture2D(texture, gl_FragCoord.xy / texturesize).rgb, 1.0);
}


>>> fchunk

void main() {
	float h = hmin + (hmax - hmin) * gl_FragCoord.y / viewportsize.y;
	float f = 440.0 * exp(h * log(2.0) / 12.0);
	float jchunk = gl_FragCoord.x;
	float W = viewportsize.x * viewportsize.y;
	vec2 z = vec2(0.0, 0.0);
	for (int i = 0; i < C; ++i) {
		float m = float(i) + float(C) * jchunk;
		float w = window((m + 1.0) / (W + 1.0));
		vec2 tpos = vec2(float(i), jchunk) / texturesize;
		float v = texture2D(texture, tpos).r * 2.0 - 1.0;
		float phi = m * f / F * tau;
		z.x += v * w * cos(phi);
		z.y += v * w * sin(phi);
	}
	float wmax = window(0.5);
	z /= float(C) * wmax;
	z *= f / 220.0;
	gl_FragColor.rg = toshort(z.x);
	gl_FragColor.ba = toshort(z.y);
}


>>> fspec

void main() {
	float h = hmin + (hmax - hmin) * gl_FragCoord.y / viewportsize.y;
	float f = exp(h * log(2.0) / 12.0);
	float y = gl_FragCoord.y;
	vec2 z = vec2(0.0, 0.0);
	for (int i = 0; i < P; ++i) {
		vec2 tpos = vec2(float(i), y) / texturesize;
		vec4 s = texture2D(texture, tpos);
		z.x += fromshort(s.rg);
		z.y += fromshort(s.ba);
	}
	z /= float(P);
	float a = length(z) * f * f * 2.0;
	a = log(a) * 0.2 + 1.0;
	gl_FragColor = vec4(clamp(vec3(a), 0.0, 1.0), 1.0);
}

