import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, ItemView } from 'obsidian';
import { SparkAPI } from './api';

interface MyPluginSettings {
	// API 设置
	apiKey: string;
	apiSecret: string;
	appId: string;
	domain: string;
	excludeFolders: string;
	keywordsProperty: string; // 关键词属性名
	lastIndexTimeProperty: string; // 最后索引时间的属性名
	similarityThreshold: number; // 相似度阈值
	openMode: 'current' | 'new' | 'split'; // 笔记打开方式
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	apiKey: '',
	apiSecret: '',
	appId: '',
	domain: 'generalv3',
	excludeFolders: '',
	keywordsProperty: 'keywords',
	lastIndexTimeProperty: 'lastIndexTime',
	similarityThreshold: 0.1, // 默认相似度阈值为 0.1 (10%)
	openMode: 'current' // 默认在当前窗口打开
}

const VIEW_TYPE_RELATED = 'related-notes-view';

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	private api: SparkAPI;

	async onload() {
		await this.loadSettings();
		
		// 初始化API
		this.api = new SparkAPI({
			apiKey: this.settings.apiKey,
			apiSecret: this.settings.apiSecret,
			appId: this.settings.appId,
			domain: this.settings.domain
		});

		// 注册视图类型
		this.registerView(
			VIEW_TYPE_RELATED,
			(leaf) => new RelatedNotesView(leaf, this)
		);

		// 添加设置选项卡
		this.addSettingTab(new RelatedNotesSettingTab(this.app, this));

		// 添加手动索引命令
		this.addCommand({
			id: 'index-current-note',
			name: '为当前笔记生成关键词索引',
			callback: async () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView?.file) {
					await this.indexNote(activeView.file);
				} else {
					new Notice('请先打开一个笔记！');
				}
			}
		});

		// 添加批量索引命令
		this.addCommand({
			id: 'index-all-notes',
			name: '为所有笔记生成关键词索引',
			callback: async () => {
				await this.indexAllNotes();
			}
		});

		// 添加打开相关笔记视图的命令
		this.addCommand({
			id: 'show-related-notes',
			name: '显示相关笔记',
			callback: async () => {
				await this.activateView();
			}
		});

		// 监听文件打开事件，更新相关笔记视图
		this.registerEvent(
			this.app.workspace.on('file-open', async (file) => {
				if (file) {
					await this.updateRelatedNotesView(file);
				}
			})
		);

		// 添加更新索引命令
		this.addCommand({
			id: 'update-notes-index',
			name: '更新笔记索引',
			callback: async () => {
				await this.reindexModifiedNotes();
			}
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// 更新API配置
		this.api = new SparkAPI({
			apiKey: this.settings.apiKey,
			apiSecret: this.settings.apiSecret,
			appId: this.settings.appId,
			domain: this.settings.domain
		});
	}

	// 激活相关笔记视图
	async activateView() {
		const { workspace } = this.app;
		
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_RELATED)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: VIEW_TYPE_RELATED,
					active: true,
				});
				leaf = rightLeaf;
			}
		}
		
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	// 更新相关笔记视图
	async updateRelatedNotesView(file: TFile) {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED);
		for (const leaf of leaves) {
			const view = leaf.view as RelatedNotesView;
			await view.updateForFile(file);
		}
	}

	// 检查笔记是否已经有关键词
	hasKeywords(file: TFile): boolean {
		const metadata = this.app.metadataCache.getFileCache(file);
		return metadata?.frontmatter?.[this.settings.keywordsProperty] !== undefined;
	}

	// 清理笔记内容，移除 frontmatter 和图片链接等
	private cleanNoteContent(content: string): string {
		// 移除 frontmatter
		content = content.replace(/^---\n[\s\S]*?\n---\n/, '');
		
		// 移除图片链接 ![]()
		content = content.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
		
		// 移除图片链接 ![[]]
		content = content.replace(/!\[\[[^\]]*\]\]/g, '');
		
		// 移除普通链接 []()
		content = content.replace(/\[[^\]]*\]\([^)]*\)/g, '');
		
		// 移除内部链接 [[]]
		content = content.replace(/\[\[[^\]]*\]\]/g, '');
		
		// 移除代码块
		content = content.replace(/```[\s\S]*?```/g, '');
		
		// 移除行内代码
		content = content.replace(/`[^`]*`/g, '');
		
		// 移除多余的空行
		content = content.replace(/\n{3,}/g, '\n\n');
		
		return content.trim();
	}

	// 为单个笔记生成关键词
	async indexNote(file: TFile) {
		const MAX_RETRIES = 3;
		let retryCount = 0;

		while (retryCount < MAX_RETRIES) {
			try {
				const content = await this.app.vault.read(file);
				const cleanedContent = this.cleanNoteContent(content);
				const keywords = await this.api.getKeywords(cleanedContent, file.basename);
				
				if (keywords && Array.isArray(keywords) && keywords.length >= 2) {
					console.log(`[索引] 笔记 ${file.basename} 获取到 ${keywords.length} 个关键词，准备更新...`);
					
					const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
					metadata[this.settings.keywordsProperty] = keywords;
					
					// 记录索引时间
					const indexTime = Date.now();
					metadata[this.settings.lastIndexTimeProperty] = indexTime;
					console.log(`[索引] 设置索引时间戳: ${new Date(indexTime).toLocaleString()}`);

					// 构建新的 frontmatter
					const newFrontMatter = `---\n${Object.entries(metadata)
						.map(([key, value]) => {
							if (Array.isArray(value)) {
								return `${key}:\n${value.map(item => `  - ${item}`).join('\n')}`;
							} else if (typeof value === 'number') {
								return `${key}: ${value}`;
							}
							return `${key}: ${JSON.stringify(value)}`;
						})
						.join('\n')}
---\n`;

					// 如果文件已有 frontmatter，替换它；否则在文件开头添加
					const hasFrontMatter = content.startsWith('---\n');
					let newContent;
					if (hasFrontMatter) {
						const endOfFrontMatter = content.indexOf('---\n', 4) + 4;
						newContent = newFrontMatter + content.slice(endOfFrontMatter);
					} else {
						newContent = newFrontMatter + content;
					}

					// 修改文件
					await this.app.vault.modify(file, newContent);
					console.log(`[索引] 文件内容已更新，等待元数据缓存刷新...`);

					// 等待元数据缓存更新
					await new Promise<void>((resolve) => {
						const handler = this.app.metadataCache.on('changed', (changedFile) => {
							if (changedFile.path === file.path) {
								this.app.metadataCache.offref(handler);
								resolve();
							}
						});

						// 设置超时，防止无限等待
						setTimeout(() => {
							this.app.metadataCache.offref(handler);
							resolve();
						}, 2000);
					});

					// 验证时间戳更新
					const updatedMetadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
					const updatedTimestamp = updatedMetadata?.[this.settings.lastIndexTimeProperty];
					
					if (updatedTimestamp === indexTime) {
						console.log(`[索引] 时间戳更新成功: ${new Date(updatedTimestamp).toLocaleString()}`);
					} else {
						console.log(`[索引] 时间戳更新可能失败：`);
						console.log(`  预期时间戳: ${new Date(indexTime).toLocaleString()}`);
						console.log(`  实际时间戳: ${updatedTimestamp ? new Date(updatedTimestamp).toLocaleString() : '未找到'}`);
					}

					return true;
				} else {
					retryCount++;
					if (retryCount < MAX_RETRIES) {
						new Notice(`笔记 ${file.basename} 未获取到有效关键词，正在重试 (${retryCount}/${MAX_RETRIES})...`, 3000);
						console.log(`[索引] 笔记 ${file.basename} 未获取到有效关键词，正在重试 (${retryCount}/${MAX_RETRIES})...`);
						await new Promise(resolve => setTimeout(resolve, 1000));
					} else {
						new Notice(`笔记 ${file.basename} 无法获取有效关键词`, 4000);
						console.log(`[索引] 笔记 ${file.basename} 无法获取有效关键词，已重试 ${MAX_RETRIES} 次`);
						return false;
					}
				}
			} catch (error) {
				retryCount++;
				if (retryCount < MAX_RETRIES) {
					new Notice(`笔记 ${file.basename} 索引出错，正在重试 (${retryCount}/${MAX_RETRIES})...`, 3000);
					console.error(`[索引] 处理笔记 ${file.path} 时出错，正在重试 (${retryCount}/${MAX_RETRIES}):`, error);
					await new Promise(resolve => setTimeout(resolve, 1000));
				} else {
					new Notice(`笔记 ${file.basename} 索引失败`, 4000);
					console.error(`[索引] 处理笔记 ${file.path} 时出错，已重试 ${MAX_RETRIES} 次:`, error);
					throw error;
				}
			}
		}

		return false;
	}

	// 为所有符合条件的笔记生成关键词
	async indexAllNotes() {
		const files = this.app.vault.getMarkdownFiles();
		const totalFiles = files.length;
		let processedFiles = 0;
		let successCount = 0;
		let errorCount = 0;

		new Notice(`开始索引所有笔记，共 ${totalFiles} 个文件...`, 3000);

		for (const file of files) {
			try {
				processedFiles++;
				const shouldIndex = await this.shouldIndexNote(file);
				if (!shouldIndex) {
					console.log(`跳过已索引的笔记: ${file.path}`);
					continue;
				}

				// 每处理10个文件显示一次进度
				if (processedFiles % 10 === 0) {
					new Notice(`正在索引：${processedFiles}/${totalFiles}`, 2000);
				}
				await this.indexNote(file);
				successCount++;
			} catch (error) {
				console.error(`索引笔记 ${file.path} 失败:`, error);
				errorCount++;
			}
		}

		new Notice(`索引完成！成功: ${successCount}, 失败: ${errorCount}, 跳过: ${totalFiles - successCount - errorCount}`, 5000);
	}

	// 更新笔记的frontmatter
	async updateNoteFrontmatter(file: TFile, keywords: string[]) {
		const content = await this.app.vault.read(file);
		let newContent: string;

		// 检查是否已有frontmatter
		if (content.startsWith('---\n')) {
			// 已有frontmatter，在其中添加关键词
			const endOfFrontmatter = content.indexOf('---\n', 4);
			if (endOfFrontmatter !== -1) {
				const frontmatter = content.slice(0, endOfFrontmatter);
				const restContent = content.slice(endOfFrontmatter);
				newContent = `${frontmatter}${this.settings.keywordsProperty}: ${JSON.stringify(keywords)}\n${restContent}`;
			} else {
				newContent = content;
			}
		} else {
			// 没有frontmatter，创建新的
			newContent = `---\n${this.settings.keywordsProperty}: ${JSON.stringify(keywords)}\n---\n${content}`;
		}

		await this.app.vault.modify(file, newContent);
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_RELATED);
	}

	async shouldIndexNote(file: TFile): Promise<boolean> {
		// 检查文件是否在排除目录中
		if (this.settings.excludeFolders) {
			const excludeFolders = this.settings.excludeFolders.split(',').map(f => f.trim());
			if (excludeFolders.some(folder => file.path.startsWith(folder))) {
				return false;
			}
		}

		return true;
	}

	async updateNoteKeywords(file: TFile, keywords: string[]) {
		const content = await this.app.vault.read(file);
		const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
		
		// 更新或添加关键词
		metadata.keywords = keywords;

		// 构建新的 frontmatter
		const newFrontMatter = `---\n${Object.entries(metadata)
			.map(([key, value]) => {
				if (Array.isArray(value)) {
					return `${key}:\n${value.map(item => `  - ${item}`).join('\n')}`;
				}
				return `${key}: ${value}`;
			})
			.join('\n')}
---\n`;

		// 如果文件已有 frontmatter，替换它；否则在文件开头添加
		const hasFrontMatter = content.startsWith('---\n');
		let newContent;
		if (hasFrontMatter) {
			const endOfFrontMatter = content.indexOf('---\n', 4) + 4;
			newContent = newFrontMatter + content.slice(endOfFrontMatter);
		} else {
			newContent = newFrontMatter + content;
		}

		// 保存文件
		await this.app.vault.modify(file, newContent);
	}

	// 删除所有笔记的关键词索引
	async removeAllKeywords() {
		const files = this.app.vault.getMarkdownFiles();
		const totalFiles = files.length;
		let processedFiles = 0;
		let modifiedCount = 0;

		new Notice(`开始删除所有笔记的关键词索引，共 ${totalFiles} 个文件...`, 3000);

		for (const file of files) {
			try {
				processedFiles++;
				const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
				if (metadata && metadata[this.settings.keywordsProperty]) {
					const content = await this.app.vault.read(file);
					// 移除关键词属性
					delete metadata[this.settings.keywordsProperty];
					
					// 重建 frontmatter
					const newFrontMatter = Object.keys(metadata).length > 0 
						? `---\n${Object.entries(metadata)
							.map(([key, value]) => {
								if (Array.isArray(value)) {
									return `${key}:\n${value.map(item => `  - ${item}`).join('\n')}`;
								}
								return `${key}: ${value}`;
							})
							.join('\n')}
---\n`
						: '';

					// 如果文件有 frontmatter，替换它
					const hasFrontMatter = content.startsWith('---\n');
					let newContent;
					if (hasFrontMatter) {
						const endOfFrontMatter = content.indexOf('---\n', 4) + 4;
						newContent = newFrontMatter + content.slice(endOfFrontMatter);
					} else {
						newContent = content;
					}

					await this.app.vault.modify(file, newContent);
					modifiedCount++;
					
					// 每处理5个文件显示一次进度
					if (processedFiles % 5 === 0) {
						new Notice(`正在处理：${processedFiles}/${totalFiles}`, 2000);
					}
				}
			} catch (error) {
				console.error(`处理笔记 ${file.path} 时出错:`, error);
			}
		}

		new Notice(`删除完成！已从 ${modifiedCount} 个笔记中移除关键词索引`, 5000);
	}

	// 检查笔记是否需要重新索引
	private shouldReindexNote(file: TFile, metadata: any): boolean {
		// 检查文件是否在排除目录中
		if (this.settings.excludeFolders) {
			const excludeFolders = this.settings.excludeFolders.split(',').map(f => f.trim());
			if (excludeFolders.some(folder => file.path.startsWith(folder))) {
				return false;
			}
		}

		// 获取最后索引时间
		const lastIndexTime = metadata?.[this.settings.lastIndexTimeProperty];
		if (!lastIndexTime) {
			console.log(`笔记 ${file.basename} 从未索引过`);
			return true;
		}

		// 确保时间戳是数字类型
		const lastIndexTimestamp = typeof lastIndexTime === 'number' 
			? lastIndexTime 
			: parseInt(lastIndexTime);

		if (isNaN(lastIndexTimestamp)) {
			console.log(`笔记 ${file.basename} 的上次索引时间无效`);
			return true;
		}

		// 获取文件最后修改时间
		const lastModified = file.stat.mtime;
		
		// 计算时间差（秒）
		const timeDiff = Math.round((lastModified - lastIndexTimestamp) / 1000);
		const MIN_TIME_DIFF = 120; // 最小时间差（秒）
		
		// 比较时间，只有修改时间晚于索引时间超过阈值时才需要重新索引
		const needsReindex = timeDiff > MIN_TIME_DIFF;

		// 只在需要重新索引时输出信息
		if (needsReindex) {
			console.log(`笔记 ${file.basename} 需要重新索引：`);
			console.log(`  上次索引时间: ${new Date(lastIndexTimestamp).toLocaleString()}`);
			console.log(`  最后修改时间: ${new Date(lastModified).toLocaleString()}`);
			console.log(`  时间差: ${timeDiff} 秒`);
		} else if (timeDiff > 0) {
			console.log(`笔记 ${file.basename} 时间差不足：`);
			console.log(`  时间差: ${timeDiff} 秒 (需要 > ${MIN_TIME_DIFF} 秒)`);
		}

		return needsReindex;
	}

	// 辅助函数：检查文件路径是否匹配 glob 模式
	private matchGlobPattern(filePath: string, pattern: string): boolean {
		// 将 glob 模式转换为正则表达式
		const regexPattern = pattern
			.replace(/\./g, '\\.')   // 转义点号
			.replace(/\*\*/g, '.*')  // ** 匹配任意字符
			.replace(/\*/g, '[^/]*'); // * 匹配除路径分隔符外的任意字符
		
		const regex = new RegExp(`^${regexPattern}$`);
		return regex.test(filePath);
	}

	// 手动重新索引已修改的笔记
	async reindexModifiedNotes() {
		const files = this.app.vault.getMarkdownFiles();
		const totalFiles = files.length;
		let processedFiles = 0;
		let reindexedCount = 0;
		let skippedCount = 0;
		let errorCount = 0;

		new Notice(`开始检查已修改的笔记，共 ${totalFiles} 个文件...`, 3000);

		for (const file of files) {
			try {
				processedFiles++;
				const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
				
				if (this.shouldReindexNote(file, metadata)) {
					// 每处理10个文件显示一次进度
					if (processedFiles % 10 === 0) {
						new Notice(`正在处理：${processedFiles}/${totalFiles}`, 2000);
					}
					await this.indexNote(file);
					reindexedCount++;
					console.log(`成功重新索引笔记: ${file.path}`);
				} else {
					skippedCount++;
				}
			} catch (error) {
				console.error(`重新索引笔记 ${file.path} 时出错:`, error);
				errorCount++;
			}
		}

		new Notice(`更新完成！已更新: ${reindexedCount}, 失败: ${errorCount}, 跳过: ${skippedCount}`, 5000);
	}

	// 检查并重新索引需要更新的笔记
	private async checkAndReindexNotes() {
		const files = this.app.vault.getMarkdownFiles();
		const totalFiles = files.length;
		let processedFiles = 0;
		let reindexedCount = 0;
		let skippedCount = 0;

		new Notice(`开始检查需要重新索引的笔记，共 ${totalFiles} 个文件...`);

		for (const file of files) {
			try {
				processedFiles++;
				const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
				
				if (this.shouldReindexNote(file, metadata)) {
					new Notice(`正在重新索引：${file.basename} (${processedFiles}/${totalFiles})`);
					await this.indexNote(file);
					reindexedCount++;
					console.log(`成功重新索引笔记: ${file.path}`);
				} else {
					skippedCount++;
				}

				if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
					new Notice(`处理进度：${processedFiles}/${totalFiles}`);
				}
			} catch (error) {
				console.error(`检查笔记 ${file.path} 时出错:`, error);
			}
		}

		new Notice(`检查完成！已更新: ${reindexedCount}, 跳过: ${skippedCount}`);
	}

	// 为笔记生成关键词并记录时间戳
	async indexNoteWithTimestamp(file: TFile) {
		const content = await this.app.vault.read(file);
		const cleanedContent = this.cleanNoteContent(content);
		const keywords = await this.api.getKeywords(cleanedContent, file.basename);
		
		if (keywords && keywords.length > 0) {
			const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
			metadata[this.settings.keywordsProperty] = keywords;
			
			// 记录索引时间
			const indexTime = Date.now();
			metadata[this.settings.lastIndexTimeProperty] = indexTime;
			console.log(`为笔记 ${file.basename} 添加索引时间戳: ${new Date(indexTime).toLocaleString()}`);

			// 构建新的 frontmatter
			const newFrontMatter = `---\n${Object.entries(metadata)
				.map(([key, value]) => {
					if (Array.isArray(value)) {
						return `${key}:\n${value.map(item => `  - ${item}`).join('\n')}`;
					} else if (typeof value === 'number') {
						return `${key}: ${value}`;
					}
					return `${key}: ${JSON.stringify(value)}`;
				})
				.join('\n')}
---\n`;

			// 如果文件已有 frontmatter，替换它；否则在文件开头添加
			const hasFrontMatter = content.startsWith('---\n');
			let newContent;
			if (hasFrontMatter) {
				const endOfFrontMatter = content.indexOf('---\n', 4) + 4;
				newContent = newFrontMatter + content.slice(endOfFrontMatter);
			} else {
				newContent = newFrontMatter + content;
			}

			await this.app.vault.modify(file, newContent);
			return true;
		}
		return false;
	}
}

class RelatedNotesView extends ItemView {
	private plugin: MyPlugin;
	private content: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_RELATED;
	}

	getDisplayText(): string {
		return '相关笔记';
	}

	getIcon(): string {
		return 'files';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('related-notes-container');

		// 添加样式
		const style = document.createElement('style');
		style.textContent = `
			.related-notes-container {
				padding: 0;
				background-color: var(--background-primary);
				height: 100%;
				display: flex;
				flex-direction: column;
				overflow: hidden;
			}
			.related-notes-header {
				display: flex;
				align-items: center;
				padding: 8px 12px;
				border-bottom: 1px solid var(--background-modifier-border);
				min-height: 28px;
			}
			.related-notes-header-text {
				font-size: 13px;
				font-weight: 500;
				color: var(--text-muted);
			}
			.related-notes-content {
				padding: 4px;
				overflow-y: auto;
				flex: 1 1 auto;
				height: 0;
			}
			.related-note-item {
				display: flex;
				padding: 8px;
				margin-bottom: 4px;
				border-radius: 4px;
				transition: background-color 0.2s;
				cursor: pointer;
				text-decoration: none !important;
				color: var(--text-normal);
			}
			.related-note-item:hover {
				background-color: var(--background-modifier-hover);
			}
			.related-note-info {
				flex: 1;
				min-width: 0;
			}
			.related-note-title {
				font-size: 13px;
				font-weight: 400;
				margin-bottom: 2px;
				color: var(--text-normal);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.related-note-excerpt {
				font-size: 12px;
				color: var(--text-muted);
				margin-bottom: 2px;
				display: -webkit-box;
				-webkit-line-clamp: 2;
				-webkit-box-orient: vertical;
				overflow: hidden;
				opacity: 0.8;
			}
			.related-note-similarity {
				font-size: 11px;
				color: var(--text-faint);
			}
			.related-notes-empty {
				display: flex;
				align-items: center;
				justify-content: center;
				height: 100px;
				color: var(--text-muted);
				font-size: 13px;
				opacity: 0.6;
			}
		`;
		document.head.appendChild(style);

		this.content = container.createDiv('related-notes-content');
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			await this.updateForFile(activeFile);
		} else {
			const emptyDiv = this.content.createDiv('related-notes-empty');
			emptyDiv.setText('请打开一个笔记');
		}
	}

	private async openFile(file: TFile) {
		const { workspace } = this.app;
		
		switch (this.plugin.settings.openMode) {
			case 'new':
				// 在新标签页中打开
				const leaf = workspace.getLeaf('tab');
				await leaf.openFile(file);
				break;
			
			case 'split':
				// 在分割视图中打开
				const existingLeaf = workspace.getLeavesOfType('markdown').find(leaf => 
					(leaf.view as MarkdownView).file?.path === file.path
				);

				if (existingLeaf) {
					// 如果文件已经打开，激活对应的叶子
					workspace.setActiveLeaf(existingLeaf);
				} else {
					// 创建新的分割视图
					const newLeaf = workspace.splitActiveLeaf();
					await newLeaf.openFile(file);
				}
				break;
			
			case 'current':
			default:
				// 在当前窗口打开
				const activeLeaf = workspace.getLeaf();
				await activeLeaf.openFile(file);
				break;
		}
	}

	async updateForFile(file: TFile) {
		this.content.empty();

		// 创建头部
		const header = this.content.createDiv('related-notes-header');
		const headerText = header.createDiv('related-notes-header-text');
		headerText.setText(file.basename);

		const content = await this.app.vault.read(file);
		const allFiles = this.app.vault.getMarkdownFiles();
		const relatedNotes = [];

		// 显示处理进度
		new Notice(`正在计算相关笔记...`, 2000);

		for (const otherFile of allFiles) {
			if (otherFile.path === file.path) continue;

			const otherContent = await this.app.vault.read(otherFile);
			const similarity = this.calculateSimilarity(content, otherContent, file, otherFile);
			if (similarity > this.plugin.settings.similarityThreshold) {
				relatedNotes.push({
					file: otherFile,
					similarity: similarity,
					excerpt: this.getExcerpt(otherContent)
				});
			}
		}

		// 按相似度从高到低排序
		relatedNotes.sort((a, b) => b.similarity - a.similarity);

		// 显示相关笔记
		const notesContainer = this.content.createDiv('related-notes-list');
		
		if (relatedNotes.length === 0) {
			const emptyDiv = notesContainer.createDiv('related-notes-empty');
			emptyDiv.setText('未找到相关笔记');
		} else {
			new Notice(`找到 ${relatedNotes.length} 个相关笔记`, 2000);
			
			for (const note of relatedNotes) {
				const noteItem = notesContainer.createEl('a', {
					cls: 'related-note-item',
					href: '#'
				});

				const noteInfo = noteItem.createDiv('related-note-info');
				const titleDiv = noteInfo.createDiv('related-note-title');
				titleDiv.setText(note.file.basename);
				
				const excerptDiv = noteInfo.createDiv('related-note-excerpt');
				excerptDiv.setText(note.excerpt);
				
				const similarityDiv = noteInfo.createDiv('related-note-similarity');
				similarityDiv.setText(`相似度: ${(note.similarity * 100).toFixed(1)}%`);

				noteItem.addEventListener('click', async (e) => {
					e.preventDefault();
					await this.openFile(note.file);
				});
			}
		}
	}

	private getExcerpt(content: string): string {
		// 移除 frontmatter
		content = content.replace(/^---\n[\s\S]*?\n---\n/, '');
		// 移除 Markdown 语法
		content = content.replace(/[#*`\[\]]/g, '');
		// 获取前 100 个字符
		return content.trim().slice(0, 100) + '...';
	}

	private calculateSimilarity(text1: string, text2: string, file1: TFile, file2: TFile): number {
		try {
			// 获取文件的元数据
			const metadata1 = this.app.metadataCache.getFileCache(file1)?.frontmatter;
			const metadata2 = this.app.metadataCache.getFileCache(file2)?.frontmatter;

			// 获取关键词（如果有）
			const keywords1: string[] = metadata1?.[this.plugin.settings.keywordsProperty] || [];
			const keywords2: string[] = metadata2?.[this.plugin.settings.keywordsProperty] || [];

			console.log(`计算关键词相似度 - ${file1.basename} vs ${file2.basename}:`);
			console.log(`  关键词1:`, keywords1);
			console.log(`  关键词2:`, keywords2);

			// 将关键词拆分成字符
			const keywordsChars1 = new Set(keywords1.join('').split(''));
			const keywordsChars2 = new Set(keywords2.join('').split(''));

			// 计算关键词字符的相似度
			const keywordsIntersection = new Set([...keywordsChars1].filter(x => keywordsChars2.has(x)));
			const keywordsUnion = new Set([...keywordsChars1, ...keywordsChars2]);
			const keywordsSimilarity = keywordsIntersection.size / keywordsUnion.size || 0;

			console.log(`  关键词字符交集:`, [...keywordsIntersection]);
			console.log(`  关键词字符并集:`, [...keywordsUnion]);
			console.log(`  关键词相似度: ${(keywordsSimilarity * 100).toFixed(1)}%`);

			// 获取标题（从文件名中提取）
			const title1 = file1.basename;
			const title2 = file2.basename;

			// 将标题分词
			const titleWords1 = new Set(this.tokenizeText(title1));
			const titleWords2 = new Set(this.tokenizeText(title2));

			// 计算标题的相似度
			const titleIntersection = new Set([...titleWords1].filter(x => titleWords2.has(x)));
			const titleUnion = new Set([...titleWords1, ...titleWords2]);
			const titleSimilarity = titleIntersection.size / titleUnion.size;

			// 加权计算总相似度
			// 标题权重 0.5，关键词权重 0.5
			const totalSimilarity = (
				titleSimilarity * 0.5 +
				keywordsSimilarity * 0.5
			);

			console.log(`相似度计算结果 - ${file1.basename} vs ${file2.basename}:`);
			console.log(`  标题相似度: ${(titleSimilarity * 100).toFixed(1)}%`);
			console.log(`  关键词相似度: ${(keywordsSimilarity * 100).toFixed(1)}%`);
			console.log(`  总相似度: ${(totalSimilarity * 100).toFixed(1)}%`);

			return totalSimilarity;
		} catch (error) {
			console.error('计算相似度时出错:', error);
			return 0;
		}
	}

	private tokenizeText(text: string): string[] {
		// 移除标点符号和特殊字符
		const cleanText = text.toLowerCase()
			.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		// 分词（简单按空格分割，可以根据需要使用更复杂的分词算法）
		const words = cleanText.split(/\s+/);

		// 对于中文，按字符分割
		const chineseWords = cleanText.match(/[\u4e00-\u9fa5]+/g) || [];
		const chineseChars = chineseWords.join('').split('');

		// 合并英文词和中文字
		return [...words, ...chineseChars];
	}
}

class RelatedNotesSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		// API 设置
		containerEl.createEl('h2', {text: 'API 设置'});

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('讯飞星火 API Key')
			.addText(text => text
				.setPlaceholder('输入 API Key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API Secret')
			.setDesc('讯飞星火 API Secret')
			.addText(text => text
				.setPlaceholder('输入 API Secret')
				.setValue(this.plugin.settings.apiSecret)
				.onChange(async (value) => {
					this.plugin.settings.apiSecret = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('App ID')
			.setDesc('讯飞星火 App ID')
			.addText(text => text
				.setPlaceholder('输入 App ID')
				.setValue(this.plugin.settings.appId)
				.onChange(async (value) => {
					this.plugin.settings.appId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API 域名')
			.setDesc('选择要使用的星火大模型版本')
			.addDropdown(dropdown => dropdown
				.addOption('generalv3', '通用版V3')
				.addOption('generalv3.5', '通用版V3.5')
				.addOption('4.0Ultra', '4.0Ultra')
				.addOption('max-32k', 'max-32k')
				.addOption('pro-128k', 'pro-128k')
				.addOption('lite', 'lite')
				.setValue(this.plugin.settings.domain)
				.onChange(async (value) => {
					this.plugin.settings.domain = value;
						await this.plugin.saveSettings();
				}));

		// 索引设置
		containerEl.createEl('h2', {text: '索引设置'});

		new Setting(containerEl)
			.setName('排除文件夹')
			.setDesc('不索引这些文件夹中的笔记（用逗号分隔多个文件夹）')
			.addText(text => text
				.setPlaceholder('folder1,folder2')
				.setValue(this.plugin.settings.excludeFolders)
				.onChange(async (value) => {
					this.plugin.settings.excludeFolders = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('关键词属性名')
			.setDesc('在frontmatter中存储关键词的属性名')
			.addText(text => text
				.setPlaceholder('keywords')
				.setValue(this.plugin.settings.keywordsProperty)
				.onChange(async (value) => {
					this.plugin.settings.keywordsProperty = value;
					await this.plugin.saveSettings();
				}));

		// 相关笔记设置
		containerEl.createEl('h2', {text: '相关笔记设置'});

		new Setting(containerEl)
			.setName('相似度阈值')
			.setDesc('只显示相似度高于此阈值的笔记（范围：0-1，例如：0.1 表示 10%）')
			.addText(text => text
				.setPlaceholder('0.1')
				.setValue(this.plugin.settings.similarityThreshold.toString())
				.onChange(async (value) => {
					const numValue = parseFloat(value);
					if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
						this.plugin.settings.similarityThreshold = numValue;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('笔记打开方式')
			.setDesc('选择点击相关笔记时的打开方式')
			.addDropdown(dropdown => dropdown
				.addOption('current', '在当前标签页打开')
				.addOption('new', '在新标签页打开')
				.addOption('split', '在分割视图中打开')
				.setValue(this.plugin.settings.openMode)
				.onChange(async (value: 'current' | 'new' | 'split') => {
					this.plugin.settings.openMode = value;
					await this.plugin.saveSettings();
				}));

		// 手动索引按钮
		new Setting(containerEl)
			.setName('手动索引')
			.setDesc('为所有笔记生成关键词索引')
			.addButton(button => button
				.setButtonText('开始索引')
				.onClick(async () => {
					await this.plugin.indexAllNotes();
				}));

		// 更新索引按钮
		new Setting(containerEl)
			.setName('更新索引')
			.setDesc('更新已修改笔记的关键词索引')
			.addButton(button => button
				.setButtonText('更新索引')
				.onClick(async () => {
					await this.plugin.reindexModifiedNotes();
				}));

		// 删除索引按钮
		new Setting(containerEl)
			.setName('删除所有索引')
			.setDesc('从所有笔记中删除关键词索引')
			.addButton(button => button
				.setButtonText('删除索引')
				.setWarning()
				.onClick(async () => {
					const confirmed = await new Promise<boolean>((resolve) => {
						const modal = new Modal(this.app);
						modal.titleEl.setText('确认删除');
						modal.contentEl.setText('确定要删除所有笔记的关键词索引吗？此操作不可撤销。');
						
						modal.contentEl.createDiv('modal-button-container', (buttonContainer) => {
							buttonContainer.createEl('button', { text: '取消' })
								.addEventListener('click', () => {
									modal.close();
									resolve(false);
								});
							
							const confirmButton = buttonContainer.createEl('button', {
								text: '确认删除',
								cls: 'mod-warning'
							});
							confirmButton.addEventListener('click', () => {
								modal.close();
								resolve(true);
							});
						});
						
						modal.open();
					});

					if (confirmed) {
						await this.plugin.removeAllKeywords();
					}
				}));
	}
}
