import { App, Editor, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_RELATED } from './types';
import { SparkAPI } from './api';
import { DEFAULT_SETTINGS, MyPluginSettings } from './types';
import RelatedNotesSettingTab from './settings';
import RelatedNotesView from './view';

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
