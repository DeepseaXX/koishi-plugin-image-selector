# 旧版本数据迁移与别名冲突检查 - 改动总结

## 📋 改动概览

本次更新完成了两个关键功能：
1. **旧版本数据迁移** - 从旧的文件夹名格式读取并转换为新的 JSON 配置格式
2. **别名冲突检查** - 在 JSON 配置和文件夹系统两个层面进行全面检查

## 🔄 改动详解

### 1. 增强的数据迁移函数 `migrateOldRecords()`

#### 旧版本存储格式
- 文件夹名编码别名：`keyword-alias1-alias2...`
- 无 JSON 配置文件
- 无上传者跟踪信息

#### 新版本存储格式
- JSON 配置：`alias-config.json` + `records-config.json`
- 结构化的关键词和别名
- 可追溯的上传者信息

#### 迁移流程

```
1. 检查 records-config.json 是否存在
   └─ 已存在 → 跳过迁移
   └─ 不存在 → 继续迁移

2. 尝试加载现有的 alias-config.json
   └─ 成功 → 使用现有配置
   └─ 失败 → 从文件夹脆弱扫描

3. 从文件夹脆弱扫描
   ├─ 遍历 images/ 目录下所有文件夹
   ├─ 解析文件夹名：keyword-alias1-alias2
   │  └─ parts = folderName.split('-')
   │  └─ keyword = parts[0]
   │  └─ aliases = parts.slice(1)
   └─ 生成 alias-config.json

4. 为每个关键词生成迁移记录
   ├─ 扫描该关键词文件夹下的媒体文件
   ├─ 创建 RecordConfig，标记为 recordedUserId='unknown'
   └─ 保存到 records-config.json
```

#### 代码示例

```typescript
// 解析旧格式文件夹名
const parts = folderName.split('-')
const keyword = parts[0]           // 'character'
const aliases = parts.slice(1)     // ['anime', 'cute']
// 结果: keyword='character', aliases=['anime', 'cute']
```

### 2. 别名冲突检查增强

#### 三层检查机制

**第一层：JSON配置内部检查**
```typescript
// 检查是否与同关键词内的别名冲突
if (configItem.aliases.includes(sanitizedAlias) || sanitizedAlias === mainKeyword)

// 检查是否与其他关键词冲突
for (const item of aliasConfig) {
    if (item.keyword === sanitizedAlias || item.aliases.includes(sanitizedAlias))
}
```

**第二层：文件夹系统检查**
```typescript
// 扫描实际文件夹系统
const folders = folder.filter(f => f.isDirectory()).map(f => f.name)
for (const folderName of folders) {
    const parts = folderName.split('-')
    if (parts.includes(sanitizedAlias))
        // 已存在冲突，拒绝添加
}
```

**第三层：创建关键词时的全面检查**
```typescript
// 不仅检查 JSON 配置，还扫描所有文件夹部分
const allParts = [mainPart, ...aliasParts]
for (const part of allParts) {
    if (folderParts.includes(part))
        // 新关键词或其别名与现有部分冲突
}
```

#### 检查覆盖

| 操作 | JSON配置 | 文件夹系统 | 其他关键词 |
|------|---------|----------|----------|
| **添加别名** | ✅ | ✅ | ✅ |
| **创建关键词** | ✅ | ✅ | ✅ |

### 3. 添加别名指令改动

**文件位置**：`src/index.ts` - 添加别名命令处理

**改动内容**：
```diff
// 检查是否与JSON配置中的其他关键词冲突
for (const item of aliasConfig) {
    if (item.keyword === sanitizedAlias || item.aliases.includes(sanitizedAlias)) {
        return formatMessage(
-           `别名 "${alias}" 与现有关键词冲突喵！`,
-           `别名 "${alias}" 与现有关键词冲突，无法添加。`
+           `别名 "${alias}" 与现有关键词或别名冲突喵！`,
+           `别名 "${alias}" 与现有关键词或别名冲突，无法添加。`
        )
    }
}

+ // 检查整个文件夹系统中是否已存在该别名
+ try {
+     const imagePath = getImagePath(groupName)
+     const folder = await fs.readdir(imagePath, { withFileTypes: true })
+     const folders = folder.filter(f => f.isDirectory()).map(f => f.name)
+     
+     for (const folderName of folders) {
+         const parts = folderName.split('-')
+         if (parts.includes(sanitizedAlias)) {
+             return formatMessage(
+                 `别名 "${alias}" 在实际文件夹中已存在喵！`,
+                 `别名 "${alias}" 在实际文件夹中已存在，无法添加。`
+             )
+         }
+     }
+ } catch (err: any) {
+     if (config.debugMode) {
+         loginfo(`检查文件夹系统时出错: ${err.message}`)
+     }
+ }
```

### 4. 创建关键词指令改动

**改动内容**：
- 新增文件夹系统全面扫描器  
- 检查关键词及其所有别名是否在文件夹中已存在
- 处理旧格式文件夹名的别名冲突检查

```typescript
// 扫描文件夹系统中的所有部分，确保没有冲突
const allParts = [mainPart, ...aliasParts]
try {
    const imagePath = getImagePath(groupName)
    const folder = await fs.readdir(imagePath, { withFileTypes: true })
    const folders = folder.filter(f => f.isDirectory()).map(f => f.name)
    
    for (const folderName of folders) {
        // 解析文件夹名中的所有部分
        const folderParts = folderName.split('-')
        
        for (const part of allParts) {
            if (folderParts.includes(part)) {
                return formatMessage(...)
            }
        }
    }
}
```

## 📊 数据迁移示例

### 场景：系统中存在旧格式文件夹

```
images/
├── character-anime-cute/
│   ├── img1.jpg
│   └── img2.jpg
├── game-rpg/
│   └── screenshot.png
└── music-pop-rock/
    ├── song1.mp3
    └── song2.mp3
```

### 迁移后生成的 JSON

**alias-config.json**：
```json
[
  {"keyword": "character", "aliases": ["anime", "cute"]},
  {"keyword": "game", "aliases": ["rpg"]},
  {"keyword": "music", "aliases": ["pop", "rock"]}
]
```

**records-config.json**：
```json
[
  {
    "groupId": "migrated",
    "recordedUserId": "unknown",
    "recordedUserName": "旧版数据",
    "keyword": "character",
    "files": [
      {"filename": "img1.jpg", "uploadTime": 0},
      {"filename": "img2.jpg", "uploadTime": 0}
    ]
  },
  ...
]
```

## ⚙️ 使用流程

### 首次启动系统时

1. **检查配置文件**
   - 存在 `alias-config.json` → 使用现有配置
   - 不存在 → 扫描文件夹结构

2. **自动迁移**
   - 解析旧格式文件夹名
   - 生成新的 JSON 配置
   - 创建初始 records-config.json

3. **继续运行**
   - 系统可立即使用新的 JSON 配置
   - 所有新操作使用新格式

### 添加别名时

1. **输入验证**
   ```bash
   /添加别名 character anime_new
   ```

2. **多层检查**
   - ✅ 检查 JSON 配置
   - ✅ 检查文件夹系统
   - ✅ 如果都没冲突 → 添加成功

3. **反馈信息**
   ```
   别名 "anime_new" 添加成功喵！
   该关键词现在有别名：anime、cute、anime_new
   ```

## 🔍 冲突检查示例

### 示例 1：添加与旧格式冲突的别名

```bash
/添加别名 character rpg
```

**检查过程**：
1. JSON 配置中检查 → ✅ 不存在
2. 文件夹系统检查 → ❌ 在 `game-rpg` 中找到 `rpg`
3. **结果**：拒绝添加，提示"别名在实际文件夹中已存在"

### 示例 2：创建与旧格式冲突的关键词

```bash
/添加关键词 anime
```

**检查过程**：
1. JSON 配置检查 → ✅ 不存在
2. 文件夹系统检查 → ❌ 在 `character-anime-cute` 中找到 `anime`
3. **结果**：拒绝创建，提示"在实际文件夹系统中已存在"

## 📝 重要说明

- ✅ **向后兼容**：旧的文件夹格式会被自动识别和迁移
- ✅ **数据安全**：迁移过程不修改原始文件，仅生成配置
- ✅ **冲突预防**：多层检查确保别名唯一性
- ⚠️ **调试模式**：建议启用 `debugMode: true` 查看迁移日志

## 🚀 完整迁移检查清单

- [x] 添加 `migrateOldRecords()` 函数支持旧格式解析
- [x] 从文件夹名读取关键词和别名信息
- [x] 生成初始 `alias-config.json` 和 `records-config.json`
- [x] 添加别名时进行文件夹系统检查
- [x] 创建关键词时进行全面冲突检查
- [x] 支持旧格式和新格式混合存在
- [x] 完整的错误日志记录
