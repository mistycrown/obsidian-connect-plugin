import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';
import { MyPluginSettings } from './types';

export default class RelatedNotesSettingTab extends PluginSettingTab {
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