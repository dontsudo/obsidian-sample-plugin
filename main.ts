import {
	App,
	FuzzySuggestModal,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import { getDocument, GlobalWorkerOptions, PDFPageProxy } from "pdfjs-dist";

interface PDFToImagePluginSettings {
	format: string;
	quality: number;
	width: number;
}

const DEFAULT_SETTINGS: PDFToImagePluginSettings = {
	format: "jpeg",
	quality: 1,
	width: 1600,
};

export default class PDFToImagePlugin extends Plugin {
	settings: PDFToImagePluginSettings;

	async onload() {
		await this.loadSettings();
		this.registerPDFJSWorker();
		this.addCommands();
		this.addSettingsTab();
	}

	registerPDFJSWorker() {
		GlobalWorkerOptions.workerSrc =
			"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
	}

	addCommands() {
		this.addCommand({
			id: "pdf-to-image",
			name: "Convert PDF to Images",
			callback: () => {
				const modal = new PDFToImageModal(
					this.app,
					this.convertPDFToImages.bind(this)
				);
				modal.open();
			},
		});
	}

	addSettingsTab() {
		this.addSettingTab(new PDFToImageSettingsTab(this.app, this));
	}

	async convertPDFToImages(file: TFile) {
		const pdfBytes = await this.app.vault.readBinary(file);
		const pdfDocument = await getDocument(pdfBytes).promise;
		const numPages = pdfDocument.numPages;

		for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
			const page = await pdfDocument.getPage(pageNumber);
			const imageData = await this.renderPageToImageData(page);
			const newFileName = this.generateImageFileName(file, pageNumber);
			await this.saveImageFile(newFileName, imageData);
			this.insertImageLink(newFileName);
		}
	}

	async renderPageToImageData(page: PDFPageProxy): Promise<string> {
		const viewport = page.getViewport({ scale: 2 });
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");

		if (context) {
			canvas.height = viewport.height;
			canvas.width = viewport.width;

			await page.render({ canvasContext: context, viewport: viewport })
				.promise;

			return canvas.toDataURL(
				`image/${this.settings.format}`,
				this.settings.quality
			);
		} else {
			throw new Error("Failed to get 2D rendering context for canvas.");
		}
	}

	generateImageFileName(file: TFile, pageNumber: number): string {
		const newFileName = `${file.basename}_p${pageNumber}.${this.settings.format}`;

		return file.parent?.isRoot
			? newFileName
			: `${file.parent?.path}/${newFileName}`;
	}

	async saveImageFile(fileName: string, imageData: string) {
		const buffer = this.dataURItoBuffer(imageData);
		await this.app.vault.createBinary(fileName, buffer);
	}

	insertImageLink(fileName: string) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			activeView.editor.replaceSelection(`![[${fileName}]]\n`);
		}
	}

	async loadSettings() {
		this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	dataURItoBuffer(dataURI: string): ArrayBuffer {
		const byteString = atob(dataURI.split(",")[1]);
		const arrayBuffer = new ArrayBuffer(byteString.length);
		const uint8Array = new Uint8Array(arrayBuffer);

		for (let i = 0; i < byteString.length; i++)
			uint8Array[i] = byteString.charCodeAt(i);

		return arrayBuffer;
	}
}

class PDFToImageModal extends FuzzySuggestModal<TFile> {
	callback: (file: TFile) => void;

	constructor(app: App, callback: (file: TFile) => void) {
		super(app);
		this.callback = callback;
	}

	getItems(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((file) => file.extension === "pdf");
	}

	getItemText(item: TFile): string {
		return item.basename;
	}

	onChooseItem(item: TFile, _: MouseEvent | KeyboardEvent): void {
		this.callback(item);
	}
}

class PDFToImageSettingsTab extends PluginSettingTab {
	plugin: PDFToImagePlugin;

	constructor(app: App, plugin: PDFToImagePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "PDF to Image Settings" });

		new Setting(containerEl)
			.setName("Image Format")
			.setDesc("The format of the converted images")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						png: "PNG",
						jpeg: "JPEG",
						webp: "WebP",
					})
					.setValue(this.plugin.settings.format)
					.onChange(async (value) => {
						this.plugin.settings.format = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Image Quality")
			.setDesc("The quality of the converted images")
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.1)
					.setValue(this.plugin.settings.quality)
					.onChange(async (value) => {
						this.plugin.settings.quality = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Image Width")
			.setDesc("The width of the converted images")
			.addText((text) =>
				text
					.setPlaceholder("1600")
					.setValue(this.plugin.settings.width.toString())
					.onChange(async (value) => {
						this.plugin.settings.width = parseInt(value);
						await this.plugin.saveSettings();
					})
			);
	}
}
