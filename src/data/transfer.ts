import { normalizeImportedText } from "../doc/grammar";

/**
 * Export is the document verbatim: because the model *is* the text, a
 * round-trip through a file is lossless with no serializer in between.
 */
export function exportDoc(doc: string, filename = defaultFilename()): void {
  const url = URL.createObjectURL(new Blob([doc], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function defaultFilename(): string {
  const today = new Date();
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  return `sprintpad-${stamp}.md`;
}

/** Prompts for a file and returns its text, widened to the sprintpad grammar. */
export function importDoc(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt,text/plain,text/markdown";
    input.style.display = "none";

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? normalizeImportedText(await file.text()) : null);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });

    document.body.append(input);
    input.click();
  });
}
