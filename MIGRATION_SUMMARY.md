# 改动总结：index.ts 别名存储系统重构

## ✅ 完成项目

将 Koishi 插件的别名存储系统从 **文件夹名称方式** 改为 **JSON 配置文件方式**，与 `main.py` 和 `mapping.json` 的逻辑保持一致。

## 📋 改动清单

### 核心功能改动

| 功能 | 原实现 | 新实现 | 改进 |
|------|--------|--------|------|
| **存储方式** | 文件夹名维护（`keyword-alias1-alias2`） | JSON 配置文件（`alias-config.json`） | 清晰、灵活 |
| **别名添加** | 重命名文件夹 | 修改 JSON 数组 | 无需文件系统操作 |
| **关键词创建** | 创建带别名的文件夹 | 创建简单文件夹 + 配置项 | 文件夹名简洁 |
| **列表显示** | 解析文件夹名的 `-` 分隔符 | 直接读取 JSON 别名 | 性能优化 |
| **发图查询** | 遍历文件夹名别名 | 遍历 JSON 配置别名 | 统一逻辑 |

### 新增函数

```typescript
// 配置文件管理
getAliasConfigPath(groupName: string) // 获取配置文件路径
loadAliasConfig(groupName: string) // 从 JSON 加载配置
saveAliasConfig(groupName: string, config: AliasConfig[]) // 保存配置到 JSON
findKeywordConfig(keyword: string, groupName: string) // 查询关键词配置

// 配置接口
interface AliasConfig {
  keyword: string    // 主关键词
  aliases: string[]  // 别名列表
}
```

### 修改的现有函数

| 函数名 | 改动内容 | 目的 |
|-------|--------|------|
| `findCharacterFolder()` | 从 JSON 查询代替文件夹名解析 | 统一数据源 |
| `countMediaFilesInFolder()` | 无改动 | - |
| 存图指令 | 从 JSON 查询关键词 | 保持逻辑一致 |
| 添加别名指令 | 完全重写为 JSON 操作 | 核心改动 |
| 创建关键词指令 | 改为创建简单文件夹 + JSON 项 | 核心改动 |
| 列表指令 | 从 JSON 读取别名显示 | 性能优化 |
| 发图核心函数 | 从 JSON 查询关键词和别名 | 核心改动 |

## 📂 数据结构

### 旧方式
```
images/
├── 2b-二b-nier/
│   ├── image1.jpg
│   └── image2.png
└── rem-蕾姆/
    ├── image3.jpg
    └── image4.png
```

### 新方式
```
images/
├── 2b/
│   ├── image1.jpg
│   └── image2.png
├── rem/
│   ├── image3.jpg
│   └── image4.png
└── alias-config.json
```

### alias-config.json 格式
```json
[
  {
    "keyword": "2b",
    "aliases": ["二b", "nier"]
  },
  {
    "keyword": "rem",
    "aliases": ["蕾姆"]
  }
]
```

## 🔄 迁移指南

### 对于现有用户
1. **自动兼容**: 新系统与旧系统独立运行
2. **手动迁移** (可选):
   - 删除旧的 `keyword-alias1-alias2` 文件夹
   - 使用 `添加关键词` 命令重新创建，并指定别名
   - 系统会自动生成 JSON 配置

### 对于新用户
- 直接使用新指令即可
- JSON 配置会自动生成

## 💡 后续可扩展性

现在 JSON 配置可以轻松扩展，添加更多元数据：

```typescript
interface AliasConfig {
  keyword: string      // 主关键词
  aliases: string[]    // 别名列表
  description?: string // (可选) 描述
  tags?: string[]      // (可选) 标签
  createdAt?: number   // (可选) 创建时间
  // 更多字段...
}
```

## 🎯 优势总结

✅ **与 main.py 保持一致** - 使用同样的 JSON 配置思想  
✅ **维护性更强** - 别名管理集中  
✅ **性能更优** - 无需解析文件夹名  
✅ **扩展性更好** - 易于添加新字段  
✅ **用户体验** - 别名操作更直观  
✅ **代码清晰** - 逻辑更易理解  

## 📝 相关文件

- [改动详情](./ALIAS_REFACTOR.md)
- [index.ts](./src/index.ts) - 改进后的完整代码
- [mapping.json](./mapping.json) - 参考的 main.py 配置格式
