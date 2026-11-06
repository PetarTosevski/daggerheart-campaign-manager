import type { Id } from "../../../../convex/_generated/dataModel";
import { PDF_CONTENT_TYPE, PDF_MAX_BYTES } from "../../../../convex/lib/pdf/config";

/**
 * Sends a book PDF to a Convex upload URL with progress (fetch has no upload progress, so this is XHR). Resolves the
 * storage id Convex answers with; the caller then hands it to `adminLibrary.ingest`, which checks the type, size and
 * that the id is no recorded file (rule 10; the server decides, this only reports progress).
 */
export function uploadWithProgress(url: string, file: File, onProgress: (share: number) => void): Promise<Id<"_storage">> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", file.type || PDF_CONTENT_TYPE);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed (${xhr.status}).`));
        return;
      }
      try {
        const { storageId } = JSON.parse(xhr.responseText) as { storageId?: string };
        if (!storageId) throw new Error("No storage id.");
        resolve(storageId as Id<"_storage">);
      } catch {
        reject(new Error("Upload failed."));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(file);
  });
}

/** A client-side first look (the server checks again): the code the server would return, or null. */
export function fileProblem(file: File): "BOOK_NOT_PDF" | "BOOK_TOO_LARGE" | null {
  if (file.type !== PDF_CONTENT_TYPE) return "BOOK_NOT_PDF";
  if (file.size > PDF_MAX_BYTES) return "BOOK_TOO_LARGE";
  return null;
}
