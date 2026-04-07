# 群组匹配迁移指南

## 概述

已将 `origin.ts` 中的群组匹配逻辑完全迁移到 `index.ts`，并添加了自动群组发现、诊断和数据迁移功能。

## 新增功能

### 1. 自动群组发现 (`discoverGroupsFromDisk()`)

系统启动时自动扫描磁盘上的群组文件夹，检查每个目录是否包含有效的 `images` 文件夹。

**特点：**
- 🔍 自动检测磁盘中的群组
- 📋 生成群组清单
- ⚠️ 检测未配置或不存在的群组

**示例输出：**
```
📁 发现群组文件夹: group1
📁 发现群组文件夹: group2
⚠️  未配置的群组: group2 (建议在 groupMappings 中添加)
```

### 2. 群组发现报告 (`generateGroupDiscoveryReport()`)

启动时自动生成详细的群组配置报告。

**包含内容：**
- ✅ 已配置的群组列表
- 📁 磁盘中发现的群组列表
- ⚠️ 未配置的群组警告
- ⚠️ 文件系统中不存在的群组警告

### 3. 建议映射配置生成 (`generateGroupMappingConfig()`)

自动为发现的群组生成建议的配置代码。

**生成示例：**
```typescript
groupMappings = [
  {
    groupName: 'group1',
    guildIds: [] // 添加要映射到此群组的 QQ 群 ID
  },
  {
    groupName: 'group2',
    guildIds: [] // ⚠️  未配置
  },
]
```

### 4. 自动群组迁移 (`autoMigrateAllGroups()`)

启动时自动为所有发现的群组执行数据迁移。

**迁移步骤：**
1. 发现所有磁盘上的群组
2. 对每个群组调用 `migrateOldRecords(groupName)`
3. 读取现有配置或从文件夹名称生成配置
4. 将旧格式数据转换为 JSON 配置
5. 保存迁移后的数据

**特点：**
- 🔄 一键迁移所有群组数据
- 📊 详细的迁移报告
- ⚠️ 错误处理和恢复机制

### 5. 群组状态诊断命令 (`selector/admin-group-status`)

新增管理员命令用于检查群组配置状态。

**使用方法：**
```
/selector/admin-group-status
```

**输出示例：**
```
📊 群组状态报告
==================
发现的群组: 2
- group1
- group2

已配置的群组: 1
- group1
```

## 核心迁移功能

### 群组映射系统

```typescript
// 创建群ID到群组名称的映射
const guildToGroup = new Map<string, string>()
for (const mapping of groupMappings) {
    for (const guildId of mapping.guildIds) {
        guildToGroup.set(guildId, mapping.groupName)
    }
}

// 获取群组名称（带回退机制）
function getGroupName(guildId?: string): string {
    if (guildId && guildToGroup.has(guildId)) {
        return guildToGroup.get(guildId)!
    }
    return fallbackGroupName
}

// 检查群组是否启用
function isGroupEnabled(session: Session): boolean {
    if (!session.guildId) {
        return enableForUnmappedGroups
    }
    return guildToGroup.has(session.guildId) || enableForUnmappedGroups
}
```

### 启动生命周期

插件启动时（`ctx.on('ready')`）自动执行：

```typescript
ctx.on('ready', async () => {
    // 1. 生成群组发现报告
    await generateGroupDiscoveryReport()
    
    // 2. 自动迁移所有群组（如果启用了 enableRecordSubmit 或 enableRecordDelete）
    if (config.enableRecordSubmit || config.enableRecordDelete) {
        await autoMigrateAllGroups()
    }
    
    // 3. 调试模式下生成建议的映射配置
    if (config.debugMode) {
        const mappingConfig = await generateGroupMappingConfig()
        loginfo('建议的群组映射配置：\n' + mappingConfig)
    }
})
```

## 配置示例

### 基础配置

```typescript
export default {
    basePath: './data',  // 数据存储路径
    enableRecordSubmit: false,  // 默认禁止提交新记录（只读模式）
    enableRecordDelete: true,   // 允许删除记录
    fallbackGroupName: 'default',  // 未映射群组的默认名称
    enableForUnmappedGroups: false,  // 未映射群组禁用功能
    debugMode: true,  // 启用调试模式
    
    groupMappings: [
        {
            groupName: 'group1',
            guildIds: ['12345', '54321']  // 将这些 QQ 群映射到 group1
        },
        {
            groupName: 'group2',
            guildIds: ['98765']
        }
    ]
}
```

## 数据迁移流程

### 旧格式 → 新格式

**旧格式（文件夹名称）：**
```
data/
├── group1/
│   └── images/
│       ├── keyword1/
│       │   └── image1.jpg
│       └── keyword2-alias1-alias2/
│           └── image2.jpg
└── group2/
    └── images/
        └── keyword3/
            └── image3.jpg
```

**新格式（JSON 配置）：**
```
data/
├── group1/
│   ├── alias-config.json
│   │   [
│   │     {"keyword": "keyword1", "aliases": []},
│   │     {"keyword": "keyword2", "aliases": ["alias1", "alias2"]}
│   │   ]
│   ├── records-config.json
│   │   [
│   │     {"groupId": "group1", "recordedUserId": "unknown", ..., "keyword": "keyword1"},
│   │     {"groupId": "group1", "recordedUserId": "unknown", ..., "keyword": "keyword2"}
│   │   ]
│   └── images/
│       ├── keyword1/
│       │   └── image1.jpg
│       └── keyword2/
│           └── image2.jpg
└── group2/
    ├── alias-config.json
    ├── records-config.json
    └── images/
        └── keyword3/
            └── image3.jpg
```

## 迁移检查清单

| 项目 | 状态 | 说明 |
|------|------|------|
| ✅ 群组发现函数 | 完成 | 自动扫描磁盘文件夹 |
| ✅ 发现报告生成 | 完成 | 启动时生成配置报告 |
| ✅ 自动迁移函数 | 完成 | 迁移所有群组的旧数据 |
| ✅ 群组映射系统 | 完成 | Guild ID 到群组名的映射 |
| ✅ 管理命令 | 完成 | `/selector/admin-group-status` |
| ✅ 后退机制 | 完成 | 未映射群组使用回退策略 |
| ✅ 生命周期集成 | 完成 | 启动时自动运行 |

## 故障排除

### 问题 1：未发现任何群组

**症状：** 启动日志显示 "📭 未发现任何需要迁移的群组"

**解决方案：**
1. 检查 `basePath` 配置是否正确
2. 确保群组文件夹中有 `images` 文件夹
3. 检查文件权限

### 问题 2：群组未配置警告

**症状：** 日志显示 "⚠️  未配置的群组"

**解决方案：**
1. 在 `groupMappings` 中添加该群组的配置
2. 将 QQ 群 ID 添加到对应群组的 `guildIds` 数组

### 问题 3：迁移失败

**症状：** 某个群组迁移失败

**解决方案：**
1. 启用 `debugMode: true` 查看详细错误信息
2. 检查文件系统权限
3. 查看日志中的错误提示

## 性能优化

- 📁 文件夹缓存：5分钟 TTL，减少磁盘 I/O
- 🔄 异步迁移：不阻塞插件启动
- ⚡ 智能发现：只检查包含 `images` 文件夹的目录

## 集成说明

所有群组迁移功能已完全集成到 `index.ts`：

```typescript
// ✅ 已包含
- apply() 函数中的群组初始化
- 生命周期回调 (ctx.on('ready'))
- 管理命令和诊断
- 自动数据迁移

// ✅ 无需修改
- 现有的别名配置系统
- 记录系统
- 删除功能
- 发图系统
```

## 下一步

1. **启用群组映射：** 根据生成的建议配置编辑 `groupMappings`
2. **运行迁移：** 重启插件自动执行迁移
3. **验证数据：** 使用 `/selector/admin-group-status` 检查状态
4. **监控日志：** 查看详细的迁移报告

## 支持的功能

- ✅ 多群组支持：每个群组独立数据
- ✅ 别名配置：自动从文件夹名称提取
- ✅ 记录追踪：记录谁上传了哪些文件
- ✅ 删除管理：用户可删除自己的记录
- ✅ 读写控制：`enableRecordSubmit` 标志
- ✅ 自动迁移：启动时自动转换旧格式
- ✅ 诊断工具：管理员可查看配置状态

