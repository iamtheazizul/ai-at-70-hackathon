// Browser-only image helper shared by the photo services.

/** Shrink a photo so its long side is at most maxEdge px; resolves to a JPEG Blob. */
export function resizeToJpegBlob(file, maxEdge) {
  return createImageBitmap(file, { imageOrientation: "from-image" })
    .catch(() => createImageBitmap(file)) // older browsers reject the options object
    .then((bmp) => {
      const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo."))), "image/jpeg", 0.85));
    });
}

/** Draw a photo onto a canvas whose long side is about `target` px (scales up small photos, at most `maxUp` times). */
export function scaledCanvas(file, target, maxUp = 3) {
  return createImageBitmap(file, { imageOrientation: "from-image" })
    .catch(() => createImageBitmap(file))
    .then((bmp) => {
      const k = Math.min(maxUp, target / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      return c;
    });
}
