import type { CourseChapter } from "./model";

export interface StructurePromptOptions {
  title: string;
  description: string;
  textLabel?: string;
  textValue?: string;
  targets?: CourseChapter[];
  confirmLabel: string;
}

interface DialogElements {
  structure: HTMLDialogElement;
  structureTitle: HTMLElement;
  structureDescription: HTMLElement;
  structureTextField: HTMLElement;
  structureTextLabel: HTMLElement;
  structureText: HTMLInputElement;
  structureTargetField: HTMLElement;
  structureTarget: HTMLSelectElement;
  structureConfirm: HTMLButtonElement;
  deleteEntry: HTMLDialogElement;
  deleteEntryName: HTMLElement;
  deleteEntryDirty: HTMLElement;
}

export function createStudioDialogs(elements: DialogElements) {
  const choose = (dialog: HTMLDialogElement): Promise<string> => {
    dialog.returnValue = "cancel";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue || "cancel"), { once: true });
    });
  };

  const structure = async (
    options: StructurePromptOptions,
  ): Promise<{ text?: string; target?: string } | undefined> => {
    elements.structureTitle.textContent = options.title;
    elements.structureDescription.textContent = options.description;
    elements.structureTextField.hidden = !options.textLabel;
    elements.structureTextLabel.textContent = options.textLabel ?? "";
    elements.structureText.value = options.textValue ?? "";
    elements.structureTargetField.hidden = !options.targets;
    elements.structureTarget.replaceChildren(
      ...(options.targets ?? []).map((chapter) => new Option(chapter.title, chapter.id)),
    );
    elements.structureConfirm.textContent = options.confirmLabel;
    const result = choose(elements.structure);
    if (options.textLabel) requestAnimationFrame(() => elements.structureText.select());
    if (await result !== "confirm") return undefined;
    return {
      text: options.textLabel ? elements.structureText.value.trim() : undefined,
      target: options.targets ? elements.structureTarget.value : undefined,
    };
  };

  const confirmDeleteEntry = async (title: string, hasUnsavedChanges: boolean): Promise<boolean> => {
    elements.deleteEntryName.textContent = title;
    elements.deleteEntryDirty.hidden = !hasUnsavedChanges;
    return await choose(elements.deleteEntry) === "delete";
  };

  return { choose, structure, confirmDeleteEntry };
}
