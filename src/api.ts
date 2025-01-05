import { Notice } from 'obsidian';
import * as crypto from 'crypto';

interface SparkAPIConfig {
    apiKey: string;
    apiSecret: string;
    appId: string;
    domain: string;
}

export class SparkAPI {
    private config: SparkAPIConfig;
    private getModelConfig() {
        switch (this.config.domain) {
            case '4.0Ultra':
                return {
                    url: 'wss://spark-api.xf-yun.com/v4.0/chat',
                    domain: '4.0Ultra'
                };
            case 'max-32k':
                return {
                    url: 'wss://spark-api.xf-yun.com/chat/max-32k',
                    domain: 'max-32k'
                };
            case 'generalv3.5':
                return {
                    url: 'wss://spark-api.xf-yun.com/v3.5/chat',
                    domain: 'generalv3.5'
                };
            case 'pro-128k':
                return {
                    url: 'wss://spark-api.xf-yun.com/chat/pro-128k',
                    domain: 'pro-128k'
                };
            case 'generalv3':
                return {
                    url: 'wss://spark-api.xf-yun.com/v3.1/chat',
                    domain: 'generalv3'
                };
            case 'lite':
                return {
                    url: 'wss://spark-api.xf-yun.com/v1.1/chat',
                    domain: 'lite'
                };
            default:
                throw new Error('未知的模型版本');
        }
    }

    constructor(config: SparkAPIConfig) {
        this.config = config;
    }

    private async generateAuthorization(host: string, date: string, path: string): Promise<string> {
        const signString = [
            `host: ${host}`,
            `date: ${date}`,
            `GET ${path} HTTP/1.1`
        ].join('\n');

        const hmac = crypto.createHmac('sha256', this.config.apiSecret);
        hmac.update(signString);
        const signatureBase64 = hmac.digest('base64');
        
        const authorization_origin = `api_key="${this.config.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureBase64}"`;
        
        return Buffer.from(authorization_origin).toString('base64');
    }

    async getKeywords(content: string, fileName?: string): Promise<string[]> {
        const modelConfig = this.getModelConfig();
        const host = 'spark-api.xf-yun.com';
        const date = new Date().toUTCString();
        const path = modelConfig.url.replace('wss://spark-api.xf-yun.com', '');

        try {
            if (fileName) {
                new Notice(`正在为笔记 "${fileName}" 生成关键词...`);
            }

            const authorization = await this.generateAuthorization(host, date, path);
            const params = new URLSearchParams({
                authorization: authorization,
                date: date,
                host: host
            });

            const wsUrl = `${modelConfig.url}?${params.toString()}`;
            
            return new Promise<string[]>((resolve, reject) => {
                const ws = new WebSocket(wsUrl);
                let responseText = '';

                ws.onopen = () => {
                    console.log(`[API] 开始处理笔记: ${fileName || '未知文件'}`);
                    const data = {
                        header: {
                            app_id: this.config.appId,
                            uid: "default"
                        },
                        parameter: {
                            chat: {
                                domain: modelConfig.domain,
                                temperature: 0.5,
                                max_tokens: 4096
                            }
                        },
                        payload: {
                            message: {
                                text: [
                                    {
                                        role: "system",
                                        content: "你是一个文本分析专家。请从给定的文本中提取关键词，并以JSON格式返回。要求：\n1. 返回格式为：{\"keywords\": [\"关键词1\", \"关键词2\", ...]}。\n2. 提取至少10个关键词。\n3. 关键词应包括：主题、人物、术语、理论、事件等。\n4. 这些关键词应该能够概括文本的主要内容。\n5. 严格按照JSON格式返回，不要添加任何其他解释文字。"
                                    },
                                    {
                                        role: "user",
                                        content: content
                                    }
                                ]
                            }
                        }
                    };

                    ws.send(JSON.stringify(data));
                };

                ws.onmessage = (event) => {
                    try {
                        const message = event.data;
                        if (message === 'data:[DONE]') {
                            console.log(`[API] 收到完成信号`);
                            ws.close();
                            try {
                                const jsonResponse = JSON.parse(responseText);
                                if (Array.isArray(jsonResponse.keywords)) {
                                    console.log(`[API] 成功解析关键词: ${jsonResponse.keywords.length} 个`);
                                    resolve(jsonResponse.keywords);
                                } else {
                                    console.log(`[API] JSON格式不正确，尝试其他解析方式`);
                                    const keywords = responseText
                                        .split(',')
                                        .map(keyword => keyword.trim())
                                        .filter(keyword => keyword.length > 0);
                                    resolve(keywords);
                                }
                            } catch (parseError) {
                                console.log(`[API] 解析响应失败，使用备用分割方式`);
                                const keywords = responseText
                                    .split(',')
                                    .map(keyword => keyword.trim())
                                    .filter(keyword => keyword.length > 0);
                                resolve(keywords);
                            }
                            return;
                        }

                        const jsonStr = message.replace(/^data: /, '');
                        const response = JSON.parse(jsonStr);

                        if (response.header && response.header.code !== 0) {
                            console.log(`[API] 请求错误: ${response.header.message}`);
                            ws.close();
                            reject(new Error(response.header.message || '未知错误'));
                            return;
                        }

                        if (response.payload && response.payload.choices && response.payload.choices.text) {
                            const content = response.payload.choices.text[0].content;
                            responseText += content.replace(/```/g, '').trim();
                        }
                    } catch (error) {
                        console.error(`[API] 处理响应出错:`, error);
                        if (fileName) {
                            new Notice(`处理笔记 "${fileName}" 时出错`);
                        }
                    }
                };

                ws.onerror = (event) => {
                    console.error(`[API] WebSocket错误:`, event);
                    if (fileName) {
                        new Notice(`处理笔记 "${fileName}" 时发生错误`);
                    }
                    reject(new Error('WebSocket连接错误'));
                };

                ws.onclose = () => {
                    console.log(`[API] 连接已关闭`);
                    if (!responseText) {
                        if (fileName) {
                            new Notice(`处理笔记 "${fileName}" 失败：未收到响应`);
                        }
                        reject(new Error('连接关闭但未收到响应'));
                        return;
                    }

                    try {
                        // 清理和规范化响应文本
                        responseText = responseText
                            .replace(/\n/g, '')
                            .replace(/^json/, '')
                            .replace(/^```json\s*/, '')
                            .replace(/```$/, '')
                            .trim();

                        // 尝试解析响应
                        try {
                            const jsonResponse = JSON.parse(responseText);
                            if (Array.isArray(jsonResponse.keywords)) {
                                console.log(`[API] 成功解析关键词: ${jsonResponse.keywords.length} 个`);
                                resolve(jsonResponse.keywords);
                                return;
                            }
                        } catch (e) {
                            console.log(`[API] JSON解析失败，尝试其他方式`);
                        }

                        // 尝试提取方括号中的内容
                        const keywordMatch = responseText.match(/\[(.*?)\]/);
                        if (keywordMatch) {
                            const keywordsString = keywordMatch[1];
                            const keywords = keywordsString
                                .split(',')
                                .map(k => k.trim().replace(/['"]/g, ''))
                                .filter(k => k.length > 0);
                            if (keywords.length > 0) {
                                console.log(`[API] 成功提取关键词: ${keywords.length} 个`);
                                resolve(keywords);
                                return;
                            }
                        }

                        // 最后尝试直接分割
                        const keywords = responseText
                            .split(',')
                            .map(k => k.trim().replace(/['"]/g, ''))
                            .filter(k => k.length > 0);

                        if (keywords.length > 0) {
                            console.log(`[API] 成功分割关键词: ${keywords.length} 个`);
                            resolve(keywords);
                        } else {
                            reject(new Error('无法从响应中提取关键词'));
                        }
                    } catch (error) {
                        console.error(`[API] 处理响应失败:`, error);
                        reject(new Error('处理响应失败'));
                    }
                };

                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        console.log(`[API] 请求超时`);
                        ws.close();
                        reject(new Error('连接超时'));
                    }
                }, 30000);
            });
        } catch (error) {
            console.error(`[API] 获取关键词时出错:`, error);
            throw new Error('获取关键词失败，请检查API设置和网络连接');
        }
    }
} 