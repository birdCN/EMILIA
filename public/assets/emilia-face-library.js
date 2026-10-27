// Hand-registered eye landmarks in the existing full-pose illustrations.
// Only local eye artwork is reused: no full-body frame swaps or crossfades.
// Head position, jaw, hair, torso and lips always remain on the connected rig.
export const faceLibrary = {
  empathy: { file: 'empathy', eyes: [[446, 363], [557, 382]] },
  encouraging: { file: 'encourage', eyes: [[409, 354], [524, 337]] },
  curious: { file: 'curious', eyes: [[414, 361], [529, 340]] },
  celebrating: { file: 'celebrate', eyes: [[416, 350], [541, 352]], smilingEyes: true }
};

// Similarity registration removes each illustration's baked-in head tilt.
export function eyeRegistration(source, target = [[418, 341], [537, 341]]) {
  const [a, b] = source, [c, d] = target;
  const sx = b[0] - a[0], sy = b[1] - a[1];
  const tx = d[0] - c[0], ty = d[1] - c[1];
  const divisor = sx * sx + sy * sy;
  if (divisor < 1) throw new Error('Eye landmarks must be distinct');
  const real = (sx * tx + sy * ty) / divisor;
  const imag = (sx * ty - sy * tx) / divisor;
  return [real, imag, -imag, real, c[0] - real * a[0] + imag * a[1], c[1] - imag * a[0] - real * a[1]];
}
