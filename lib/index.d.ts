import { Context, Schema } from 'koishi';
export declare const name = "image-selecter";
export declare const inject: {
    required: string[];
};
export declare const usage = "\n---\n\n<a target=\"_blank\" href=\"https://www.npmjs.com/package/koishi-plugin-image-selecter\">\u27A4 \u98DF\u7528\u65B9\u6CD5\u70B9\u6B64\u83B7\u53D6</a>\n\n---\n";
export interface Config {
    tempPath: string;
    imagePath: string;
    promptTimeout: number;
    filenameTemplate: string;
    saveCommandName: string;
    saveFailFallback: boolean;
    listCommandName: string;
    admins: {
        userId: string;
        sizeLimit: number;
    }[];
    allowNormalUserUpload: boolean;
    normalUserSizeLimit: number;
    maxout: number;
    debugMode: boolean;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
