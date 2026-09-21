const MAX_EDGE = 1600;
/** Inline images travel inside the HTML body, so keep each one well below the body limit. */
const MAX_INLINE_BYTES = 1_200_000;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Turn a pasted/dropped image into a data: URL fit for an email body: photos straight off a phone are scaled
 * down to a sensible width and re-encoded. Returns null when it still ends up too big to embed.
 */
export async function imageToDataUrl(file: File): Promise<string | null> {
  if (file.type === "image/gif" || file.type === "image/svg+xml") {
    return file.size <= MAX_INLINE_BYTES ? readAsDataUrl(file) : null;
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_INLINE_BYTES) {
    bitmap.close();
    return readAsDataUrl(file);
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // PNG keeps screenshots crisp; fall back to JPEG when that is too heavy (photos).
  for (const [type, quality] of [["image/png", undefined], ["image/jpeg", 0.85], ["image/jpeg", 0.7]] as const) {
    if (type === "image/png" && file.type === "image/jpeg") continue;
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
    if (blob && blob.size <= MAX_INLINE_BYTES) return readAsDataUrl(blob);
  }
  return null;
}

/**
 * Images in quoted mail and reopened drafts point at this server's attachment endpoint, which only works for the
 * signed-in user. Embed them so recipients get the picture instead of a broken link.
 */
export async function embedServerImages(html: string): Promise<string> {
  if (!html.includes("/api/mail/")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = [...doc.querySelectorAll<HTMLImageElement>('img[src^="/api/mail/"]')];
  if (!imgs.length) return html;
  await Promise.all(
    imgs.map(async (img) => {
      try {
        const res = await fetch(img.getAttribute("src")!, { credentials: "include" });
        if (res.ok) img.setAttribute("src", await readAsDataUrl(await res.blob()));
      } catch {
        // leave the reference as it is
      }
    }),
  );
  return doc.body.innerHTML;
}
