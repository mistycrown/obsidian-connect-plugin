import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_RELATED } from './types';
import MyPlugin from './main';
import { RelatedNote } from './types';

export default class RelatedNotesView extends ItemView {
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
        align-items: flex-start;
        justify-content: space-between;
      }
      .related-note-item:hover {
        background-color: var(--background-modifier-hover);
      }
      .related-note-info {
        flex: 1;
        min-width: 0;
        margin-right: 8px;
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
      .related-note-buttons {
        display: flex;
        flex-direction: column;
        gap: 4px;
        opacity: 0.5;
        transition: opacity 0.2s;
      }
      .related-note-item:hover .related-note-buttons {
        opacity: 1;
      }
      .related-note-button {
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: var(--text-muted);
        border-radius: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
      }
      .related-note-button:hover {
        background-color: var(--background-modifier-hover);
        color: var(--text-normal);
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
        const leaf = workspace.getLeaf('tab');
        await leaf.openFile(file);
        break;
      
      case 'split':
        const existingLeaf = workspace.getLeavesOfType('markdown').find(leaf => 
          (leaf.view as MarkdownView).file?.path === file.path
        );

        if (existingLeaf) {
          workspace.setActiveLeaf(existingLeaf);
        } else {
          const newLeaf = workspace.splitActiveLeaf();
          await newLeaf.openFile(file);
        }
        break;
      
      case 'current':
      default:
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
    const relatedNotes: RelatedNote[] = [];

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
        const noteItem = notesContainer.createEl('div', {
          cls: 'related-note-item'
        });

        const noteInfo = noteItem.createDiv('related-note-info');
        const titleDiv = noteInfo.createDiv('related-note-title');
        titleDiv.setText(note.file.basename);
        
        // 添加关键词标签容器
        const keywordsContainer = noteInfo.createDiv('related-note-keywords');
        keywordsContainer.style.display = 'flex';
        keywordsContainer.style.flexWrap = 'wrap';
        keywordsContainer.style.gap = '4px';
        keywordsContainer.style.maxHeight = '60px';
        keywordsContainer.style.overflowY = 'auto';
        keywordsContainer.style.marginBottom = '4px';
        
        // 获取并显示关键词
        const metadata = this.app.metadataCache.getFileCache(note.file)?.frontmatter;
        const keywords = metadata?.[this.plugin.settings.keywordsProperty] || [];
        keywords.forEach((keyword: string) => {
          const tag = keywordsContainer.createEl('span', {
            cls: 'keyword-tag'
          });
          tag.textContent = keyword;
          tag.style.padding = '2px 6px';
          tag.style.backgroundColor = 'var(--background-secondary)';
          tag.style.borderRadius = '4px';
          tag.style.fontSize = '12px';
          tag.style.color = 'var(--text-muted)';
        });
        
        const excerptDiv = noteInfo.createDiv('related-note-excerpt');
        excerptDiv.setText(note.excerpt);
        
        const similarityDiv = noteInfo.createDiv('related-note-similarity');
        similarityDiv.setText(`相似度: ${(note.similarity * 100).toFixed(1)}%`);

        // 添加按钮容器
        const buttonContainer = noteItem.createDiv('related-note-buttons');

        // 添加打开按钮
        const openButton = buttonContainer.createEl('button', {
          cls: 'related-note-button open-button',
          attr: {
            'aria-label': '打开笔记'
          }
        });
        openButton.innerHTML = `<svg viewBox="0 0 100 100" class="right-triangle" width="12" height="12"><path fill="currentColor" stroke="currentColor" d="M33.4,50 l33.3,-33.3 l33.3,33.3 l-33.3,33.3 Z"></path></svg>`;
        openButton.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.openFile(note.file);
        });

        // 添加复制链接按钮
        const copyButton = buttonContainer.createEl('button', {
          cls: 'related-note-button copy-button',
          attr: {
            'aria-label': '复制双链'
          }
        });
        copyButton.innerHTML = `<svg viewBox="0 0 100 100" class="link" width="12" height="12"><path fill="currentColor" stroke="currentColor" d="M43.1,54.9c-2.5,2.5-2.5,6.6,0,9.1l8.8,8.8c2.5,2.5,6.6,2.5,9.1,0l26.3-26.3c2.5-2.5,2.5-6.6,0-9.1l-8.8-8.8 c-2.5-2.5-6.6-2.5-9.1,0l-3.5,3.5 M56.9,45.1c2.5-2.5,2.5-6.6,0-9.1l-8.8-8.8c-2.5-2.5-6.6-2.5-9.1,0L12.7,53.5c-2.5,2.5-2.5,6.6,0,9.1 l8.8,8.8c2.5,2.5,6.6,2.5,9.1,0l3.5-3.5"></path></svg>`;
        copyButton.addEventListener('click', (e) => {
          e.stopPropagation();
          // 复制双链到剪贴板
          navigator.clipboard.writeText(`[[${note.file.basename}]]`).then(() => {
            new Notice('已复制双链到剪贴板', 2000);
          }).catch(err => {
            console.error('复制失败:', err);
            new Notice('复制失败', 2000);
          });
        });

        // 添加点击整个卡片打开笔记的事件
        noteItem.addEventListener('click', async (e) => {
          if (e.target === noteItem || e.target === noteInfo || e.target === titleDiv || e.target === excerptDiv || e.target === similarityDiv) {
            await this.openFile(note.file);
          }
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
    // 移除标点符号、特殊字符和数字
    const cleanText = text.toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
      .replace(/\d+/g, ' ')  // 移除数字
      .replace(/\s+/g, ' ')
      .trim();

    // 分词（简单按空格分割，可以根据需要使用更复杂的分词算法）
    const words = cleanText.split(/\s+/).filter(word => word.length > 0);

    // 对于中文，按字符分割
    const chineseWords = cleanText.match(/[\u4e00-\u9fa5]+/g) || [];
    const chineseChars = chineseWords.join('').split('');

    // 合并英文词和中文字
    return [...words, ...chineseChars];
  }
}