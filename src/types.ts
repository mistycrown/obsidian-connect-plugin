import { TFile } from 'obsidian';

export interface MyPluginSettings {
  apiKey: string;
  apiSecret: string;
  appId: string;
  domain: string;
  excludeFolders: string;
  keywordsProperty: string;
  lastIndexTimeProperty: string;
  similarityThreshold: number;
  openMode: 'current' | 'new' | 'split';
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
  apiKey: '',
  apiSecret: '',
  appId: '',
  domain: 'generalv3',
  excludeFolders: '',
  keywordsProperty: 'keywords',
  lastIndexTimeProperty: 'lastIndexTime',
  similarityThreshold: 0.1,
  openMode: 'current'
};

export const VIEW_TYPE_RELATED = 'related-notes-view';

export interface RelatedNote {
  file: TFile;
  similarity: number;
  excerpt: string;
}