import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, ItemView, WorkspaceLeaf } from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

const VIEW_TYPE_RELATED = 'related-notes-view';

// 分词函数：将文本分割成词语（支持中英文）
function tokenize(text: string): string[] {
    console.log('开始分词处理:', text.slice(0, 50) + '...');
    
    // 将文本转换为小写
    text = text.toLowerCase();
    
    // 英文单词的正则表达式
    const englishWordPattern = /[a-z]+/g;
    
    // 中文词语的正则表达式（2-4个字符可能构成一个词）
    const chineseWordPattern = /[\u4e00-\u9fa5]{2,4}/g;
    
    // 提取英文单词
    const englishWords = text.match(englishWordPattern) || [];
    console.log('提取的英文单词:', englishWords);
    
    // 提取中文词语
    const chineseWords = text.match(chineseWordPattern) || [];
    console.log('提取的中文词语:', chineseWords);
    
    // 对于剩余的单个中文字符也要考虑
    const singleChineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
    console.log('单个中文字符:', singleChineseChars);
    
    // 合并结果
    const result = [...new Set([...englishWords, ...chineseWords, ...singleChineseChars])];
    console.log('最终分词结果:', result);
    
    return result;
}

// 计算两个词语数组的相似度
function calculateArraySimilarity(arr1: string[], arr2: string[]): number {
    console.log('计算数组相似度');
    console.log('数组1:', arr1);
    console.log('数组2:', arr2);
    
    if (arr1.length === 0 || arr2.length === 0) {
        console.log('其中一个数组为空，返回0');
        return 0;
    }
    
    // 创建两个数组的词频映射
    const freq1: { [key: string]: number } = {};
    const freq2: { [key: string]: number } = {};
    
    arr1.forEach(word => {
        freq1[word] = (freq1[word] || 0) + 1;
    });
    
    arr2.forEach(word => {
        freq2[word] = (freq2[word] || 0) + 1;
    });
    
    console.log('词频统计1:', freq1);
    console.log('词频统计2:', freq2);
    
    // 计算共同词语
    let intersection = 0;
    let union = 0;
    
    // 计算交集和并集
    const allWords = new Set([...arr1, ...arr2]);
    allWords.forEach(word => {
        const count1 = freq1[word] || 0;
        const count2 = freq2[word] || 0;
        const minCount = Math.min(count1, count2);
        const maxCount = Math.max(count1, count2);
        intersection += minCount;
        union += maxCount;
        
        if (minCount > 0) {
            console.log(`共同词语: ${word}, 出现次数: ${minCount}`);
        }
    });
    
    const similarity = intersection / union;
    console.log(`相似度计算结果: ${similarity.toFixed(4)} (交集: ${intersection}, 并集: ${union})`);
    
    return similarity;
}

// 计算两个文档的相似度
function calculateDocumentSimilarity(doc1: {title: string, content: string}, doc2: {title: string, content: string}): number {
    console.log('开始计算文档相似度');
    console.log('文档1标题:', doc1.title);
    console.log('文档2标题:', doc2.title);
    
    // 分词
    console.log('处理文档1标题...');
    const title1Tokens = tokenize(doc1.title);
    console.log('处理文档2标题...');
    const title2Tokens = tokenize(doc2.title);
    console.log('处理文档1内容...');
    const content1Tokens = tokenize(doc1.content);
    console.log('处理文档2内容...');
    const content2Tokens = tokenize(doc2.content);
    
    // 计算标题和内容的相似度
    console.log('计算标题相似度...');
    const titleSimilarity = calculateArraySimilarity(title1Tokens, title2Tokens);
    console.log('计算内容相似度...');
    const contentSimilarity = calculateArraySimilarity(content1Tokens, content2Tokens);
    
    // 标题权重0.7，内容权重0.3
    const finalSimilarity = titleSimilarity * 0.7 + contentSimilarity * 0.3;
    console.log(`最终相似度: ${finalSimilarity.toFixed(4)} (标题: ${titleSimilarity.toFixed(4)}, 内容: ${contentSimilarity.toFixed(4)})`);
    
    return finalSimilarity;
}

// 相关笔记视图
class RelatedNotesView extends ItemView {
    private currentFile: TFile | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_RELATED;
    }

    getDisplayText(): string {
        return '相关笔记';
    }

    async onOpen(): Promise<void> {
        // 初始化视图
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.createEl('h4', { text: '相关笔记' });
        
        // 创建内容容器
        container.createDiv('related-notes-container');
    }

    // 更新相关笔记列表
    async updateForFile(file: TFile | null): Promise<void> {
        this.currentFile = file;
        const container = this.containerEl.children[1] as HTMLElement;
        const notesContainer = container.querySelector('.related-notes-container');
        if (!notesContainer) return;
        
        notesContainer.empty();
        
        if (!file) {
            notesContainer.createEl('p', { text: '请打开一个笔记' });
            return;
        }

        // 获取当前笔记的内容
        const currentContent = await this.app.vault.read(file);
        const currentDoc = {
            title: file.basename,
            content: currentContent
        };

        // 获取所有markdown文件
        const allFiles = this.app.vault.getMarkdownFiles();
        
        // 计算相关笔记
        const relatedNotes = await Promise.all(
            allFiles
                .filter(f => f !== file)
                .map(async f => {
                    const content = await this.app.vault.read(f);
                    return {
                        file: f,
                        similarity: calculateDocumentSimilarity(
                            currentDoc,
                            { title: f.basename, content }
                        )
                    };
                })
        );

        // 排序并过滤结果
        const filteredNotes = relatedNotes
            .sort((a, b) => b.similarity - a.similarity)
            .filter(({similarity}) => similarity > 0.1)
            .slice(0, 10);

        if (filteredNotes.length === 0) {
            notesContainer.createEl('p', { text: '没有找到相关笔记' });
            return;
        }

        // 创建相关笔记列表
        const noteList = notesContainer.createEl('div', { cls: 'related-notes-list' });
        
        filteredNotes.forEach(({file: relatedFile, similarity}) => {
            const noteDiv = noteList.createEl('div', {
                cls: 'related-note-item',
            });

            const titleEl = noteDiv.createEl('a', {
                text: `${relatedFile.basename} (${(similarity * 100).toFixed(1)}%)`,
                cls: 'related-note-title',
            });

            titleEl.addEventListener('click', async () => {
                const leaf = this.app.workspace.activeLeaf;
                if (leaf) {
                    await leaf.openFile(relatedFile);
                }
            });
        });

        // 添加样式
        container.createEl('style').setText(`
            .related-notes-container {
                padding: 10px;
            }
            .related-note-item {
                padding: 5px;
                margin: 5px 0;
                border-radius: 5px;
                cursor: pointer;
            }
            .related-note-item:hover {
                background-color: var(--background-secondary);
            }
            .related-note-title {
                color: var(--text-normal);
                text-decoration: none;
                font-size: 0.9em;
            }
        `);
    }
}

// 相关笔记显示模态窗口
class RelatedNotesModal extends Modal {
    private relatedNotes: Array<{file: TFile, similarity: number}>;

    constructor(app: App, relatedNotes: Array<{file: TFile, similarity: number}>) {
        super(app);
        this.relatedNotes = relatedNotes;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.empty();
        
        // 添加标题
        contentEl.createEl('h2', {text: '相关笔记'});
        
        if (this.relatedNotes.length === 0) {
            contentEl.createEl('p', {text: '没有找到相关笔记'});
            return;
        }

        // 创建笔记列表
        const noteList = contentEl.createEl('div');
        this.relatedNotes.forEach(({file, similarity}) => {
            const noteDiv = noteList.createEl('div', {
                cls: 'related-note-item',
            });

            // 创建可点击的标题
            const titleEl = noteDiv.createEl('a', {
                text: `${file.basename} (相似度: ${(similarity * 100).toFixed(1)}%)`,
                cls: 'related-note-title',
            });

            // 添加点击事件
            titleEl.addEventListener('click', async () => {
                // 打开笔记
                const leaf = this.app.workspace.activeLeaf;
                if (leaf) {
                    await leaf.openFile(file);
                    // 关闭模态窗口
                    this.close();
                } else {
                    new Notice('无法打开笔记');
                }
            });
        });

        // 添加一些基本样式
        noteList.style.margin = '10px 0';
        contentEl.createEl('style').setText(`
            .related-note-item {
                padding: 5px;
                margin: 5px 0;
                border-radius: 5px;
                cursor: pointer;
            }
            .related-note-item:hover {
                background-color: var(--background-secondary);
            }
            .related-note-title {
                color: var(--text-normal);
                text-decoration: none;
            }
        `);
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

export default class MyPlugin extends Plugin {
    private view: RelatedNotesView;
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

        // 注册视图
        this.registerView(
            VIEW_TYPE_RELATED,
            (leaf) => (this.view = new RelatedNotesView(leaf))
        );

        // 添加打开视图的命令
        this.addCommand({
            id: 'show-related-notes-view',
            name: '显示相关笔记视图',
            callback: async () => {
                const { workspace } = this.app;
                
                // 如果视图已经打开，就激活它
                const existingView = workspace.getLeavesOfType(VIEW_TYPE_RELATED)[0];
                if (existingView) {
                    workspace.revealLeaf(existingView);
                    return;
                }

                // 在右侧打开视图
                const leaf = workspace.getRightLeaf(false);
                if (leaf) {
                    await leaf.setViewState({
                        type: VIEW_TYPE_RELATED,
                        active: true,
                    });
                }
            },
        });

        // 监听文件打开事件
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (this.view) {
                    this.view.updateForFile(file);
                }
            })
        );

        // 初始化视图
        if (this.app.workspace.layoutReady) {
            this.initView();
        } else {
            this.app.workspace.onLayoutReady(() => this.initView());
        }

		// 添加一个查找相关笔记的命令（保留原来的命令）
		this.addCommand({
			id: 'find-related-notes',
			name: '查找相关笔记',
			callback: async () => {
				// 获取当前活动的markdown视图
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				
				if (activeView && activeView.file) {
					// 获取当前笔记的标题和内容
					const currentFile = activeView.file;
					const currentContent = await this.app.vault.read(currentFile);
					const currentDoc = {
						title: currentFile.basename,
						content: currentContent
					};
					
					// 获取所有markdown文件
					const allFiles = this.app.vault.getMarkdownFiles();
					
					// 计算每个文件与当前文件的相似度
					const relatedNotes = await Promise.all(
						allFiles
							.filter(file => file !== currentFile)
							.map(async file => {
								const content = await this.app.vault.read(file);
								return {
									file,
									similarity: calculateDocumentSimilarity(
										currentDoc,
										{ title: file.basename, content }
									)
								};
							})
					);
					
					// 排序并过滤结果
					const filteredNotes = relatedNotes
						.sort((a, b) => b.similarity - a.similarity)
						.filter(({similarity}) => similarity > 0.1)
						.slice(0, 10);
					
					// 打开模态窗口显示结果
					new RelatedNotesModal(this.app, filteredNotes).open();
				} else {
					new Notice('请先打开一个笔记！');
				}
			}
		});
	}

    private async initView() {
        // 如果视图不存在，在右侧创建它
        if (!this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED).length) {
            const leaf = this.app.workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({
                    type: VIEW_TYPE_RELATED,
                    active: true,
                });
            }
        }

        // 更新当前文件的相关笔记
        const currentFile = this.app.workspace.getActiveFile();
        if (this.view && currentFile) {
            this.view.updateForFile(currentFile);
        }
    }

	onunload() {
        // 卸载视图
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_RELATED);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
