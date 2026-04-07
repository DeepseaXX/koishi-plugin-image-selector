# 向后兼容性与模式改动总结

## 📋 改动概览

本次更新添加了**向后兼容性支持**和**禁用新增功能**，允许系统从旧版本数据无缝迁移到新模式。

## 🔄 核心改动

### 1. 配置项扩展

添加了 `enableRecordSubmit` 配置项（默认 `false` - 仅读取、删除模式）：

```typescript
enableRecordDelete: boolean     // 启用删除功能（默认true）
enableRecordSubmit: boolean     // 启用新增记录（默认false - 只读模式）
```

**用途**：
- 当 `enableRecordSubmit = false` 时：仅允许删除已有记录，不创建新记录
- 当 `enableRecordSubmit = true` 时：允许新增并记录被保存人信息

### 2. 数据迁移函数 `migrateOldRecords()`

**功能**：自动从已有图片文件生成初始 `records-config.json`

**何时触发**：
- 用户首次调用删除功能时自动触发
- 或可在插件启动时预执行

**迁移过程**：
```
已有图片文件（旧版）
    ↓
扫描所有关键词文件夹
    ↓
为每个关键词生成一条初始记录
    ↓
标记为 recordedUserId='unknown' 标识旧版数据
    ↓
保存到 records-config.json
```

**标记说明**：
- `recordedUserId='unknown'` - 无法确定原始上传者的旧版数据
- `recordedUserName='旧版数据'` - 用户名标记
- `uploadTime=0` - 无法获知上传时间

### 3. 保存逻辑改进

修改后的存图指令现在：
- **启用时** (`enableRecordSubmit=true`)：创建新的被保存人记录
- **禁用时** (`enableRecordSubmit=false`)：保存文件但不记录被保存人信息

```typescript
// 仅在启用 Record Submit 时记录被保存人信息
if (config.enableRecordSubmit && savedCount > 0) {
    // 记录用户、时间戳等信息
}
```

### 4. 删除功能增强

删除中间件现在支持**两种格式的记录删除**：

#### 新格式记录（带用户信息）
- 条件：`recordedUserId !== 'unknown'`
- 权限：仅原上传者可删除
- 验证：`session.userId === record.recordedUserId`

#### 旧格式记录（迁移的数据）
- 条件：`recordedUserId === 'unknown'`
- 权限：任何人可删除（因为无法验证身份）
- 日志：标记为 `(旧版数据)`

```typescript
// 删除中间件的权限检查逻辑
if (record.recordedUserId === 'unknown') {
    // 旧版数据，允许删除
    canDelete = true
} else if (record.recordedUserId === userId) {
    // 新版数据，只允许原上传者删除
    canDelete = true
}
```

## 📊 数据格式对比

### 旧版本存储方式
- 基于文件夹名称处理
- 无个人信息记录
- 无时间戳记录
- 无删除追溯

### 新版本存储方式

#### 新增记录格式
```json
{
  "groupId": "group_name",
  "recordedUserId": "qq_user_id",
  "recordedUserName": "用户昵称",
  "keyword": "关键词",
  "files": [
    {"filename": "file.jpg", "uploadTime": 1234567890},
    {"filename": "file2.jpg", "uploadTime": 1234567891}
  ]
}
```

#### 迁移记录格式（旧数据）
```json
{
  "groupId": "migrated",
  "recordedUserId": "unknown",
  "recordedUserName": "旧版数据",
  "keyword": "关键词",
  "files": [
    {"filename": "file.jpg", "uploadTime": 0},
    {"filename": "file2.jpg", "uploadTime": 0}
  ]
}
```

## ⚙️ 使用指南

### 启用新增记录功能

```yaml
enableRecordDelete: true      # 允许删除
enableRecordSubmit: true      # 允许新增
```

此时系统行为：
- ✅ 新保存的图片记录被保存人信息
- ✅ 允许被保存人删除自己的记录
- ✅ 与旧版数据兼容

### 禁用新增功能（默认）

```yaml
enableRecordDelete: true      # 允许删除
enableRecordSubmit: false     # 禁用新增
```

此时系统行为：
- ✅ 保存图片但不记录被保存人
- ✅ 允许删除已有的旧版数据
- ✅ 完全向后兼容
- ✅ 数据以只读模式存在

## 🔍 迁移流程详解

### 第一次调用删除功能时

```
用户发送"删除" + 回复图片
    ↓
系统检查 records-config.json 是否存在
    ↓
不存在 → 触发 migrateOldRecords()
    ↓
    扫描已有关键词文件夹中的媒体文件
    ↓
    为每个关键词生成迁移记录
    ↓
    保存到 records-config.json
    ↓
已存在 → 跳过迁移
    ↓
继续执行删除逻辑
```

### 迁移性能

- 首次迁移：扫描所有关键词和媒体文件（可能较慢）
- 后续操作：直接使用 JSON 配置（快速）
- 迁移失败：不中断插件启动，允许手动重试

## 📝 配置文件说明

### alias-config.json（已有）
```json
[
  {"keyword": "关键词1", "aliases": ["别名1", "别名2"]},
  {"keyword": "关键词2", "aliases": []}
]
```

### records-config.json（新增，自动生成）
```json
[
  {
    "groupId": "group_name",
    "recordedUserId": "user_id",
    "recordedUserName": "用户昵称",
    "keyword": "关键词",
    "files": [...]
  }
]
```

当启用迁移时，会自动生成此文件。

## 🚀 迁移建议

### 场景 1：全新安装
- 设置 `enableRecordSubmit = true` 立即启用新功能
- 系统会自动记录新增的被保存人信息

### 场景 2：现有运行中的系统（推荐）
- 保持 `enableRecordSubmit = false`（默认）
- 允许旧数据以只读模式存在
- 新保存的数据可选择启用记录
- 用户可随时删除已有数据

### 场景 3：渐进式迁移
1. 第一阶段：`enableRecordSubmit = false`（数据兼容）
2. 观察运行情况，用户测试删除功能
3. 第二阶段：`enableRecordSubmit = true`（启用新功能）

## ⚠️ 注意事项

1. **数据安全**：迁移过程中不会修改原始图片文件，仅生成元数据
2. **权限管理**：旧版数据因无法验证身份，任何人可删除
3. **日志追溯**：建议启用 `debugMode` 查看迁移和删除详情
4. **配置备份**：在启用迁移前备份现有数据

## 🔗 相关文档

- [DELETE_FEATURE.md](DELETE_FEATURE.md) - 删除功能完整说明
- [ALIAS_REFACTOR.md](ALIAS_REFACTOR.md) - 别名系统说明
- [DELETE_IMPLEMENTATION.md](DELETE_IMPLEMENTATION.md) - 删除功能改动总结
