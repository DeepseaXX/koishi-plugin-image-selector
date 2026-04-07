# 快速参考：JSON 别名存储系统

## 📌 关键文件

| 文件 | 作用 | 按需创建 |
|------|------|--------|
| `alias-config.json` | 存储别名配置 | 首次使用时自动创建 |
| `images/{keyword}/` | 存储对应关键词的图片 | 创建关键词时产生 |
| `temp/` | 临时存储 | 可选 |

## 🔧 配置文件示例

### 基本结构
```json
[
  {
    "keyword": "角色名",
    "aliases": ["别名1", "别名2"]
  }
]
```

### 完整示例
```json
[
  {
    "keyword": "2b",
    "aliases": ["二b", "nier", "偶像"]
  },
  {
    "keyword": "rem",
    "aliases": ["蕾姆", "blue_demon", "rem酱"]
  },
  {
    "keyword": "saber",
    "aliases": []
  }
]
```

## 📝 指令操作

### 创建关键词
```
/添加关键词 角色名 别名1 别名2 ...
```
- 创建文件夹：`images/角色名/`
- 生成配置项：`{"keyword": "角色名", "aliases": [...]}`

### 添加别名
```
/添加别名 角色名或现有别名 新别名
```
- 添加到现有关键词的别名列表
- 无需重命名文件夹

### 查看列表
```
/查看列表
```
- 显示所有关键词及其别名
- 显示每个关键词的图片数量

### 发送图片
```
/随机 角色名或别名 [数量]
```
- 支持使用任意别名
- 支持模糊匹配

## 🔍 文件路径映射

```
basePath/
└── {groupName}/
    ├── images/
    │   ├── 2b/
    │   │   ├── image1.jpg
    │   │   └── image2.png
    │   ├── rem/
    │   │   └── image3.jpg
    │   └── alias-config.json  ← 核心配置文件
    └── temp/ (可选)
```

## 💾 JSON 操作流程

### 创建关键词时 (内部流程)
1. 从 `alias-config.json` 加载配置
2. 检查关键词和别名是否冲突
3. 创建 `images/{keyword}/` 文件夹
4. 添加新项到配置：`{"keyword": "...", "aliases": [...]}`
5. 保存到 `alias-config.json`

### 添加别名时 (内部流程)
1. 从 `alias-config.json` 加载配置
2. 查找对应的配置项
3. 将新别名加入 `aliases` 数组
4. 保存回 `alias-config.json`

### 查询关键词时 (内部流程)
1. 从 `alias-config.json` 加载配置
2. 遍历所有配置项
3. 检查关键词或别名是否匹配
4. 返回匹配的 `keyword`（主关键词）

## 🆚 新旧对比

### 查看别名方式
```
原方式：查看文件夹名    keyword-alias1-alias2
新方式：查看JSON文本   alias-config.json
```

### 添加别名方式
```
原方式：重命名文件系统   keyword → keyword-alias
新方式：修改 JSON 数组  aliases: ["alias"]
```

### 配置位置
```
原方式：分散在所有文件夹名
新方式：集中在一个 JSON 文件 ✨
```

## ✨ 最佳实践

1. **定期备份 `alias-config.json`** - 这是配置的唯一来源
2. **直接编辑 JSON** - 可以快速批量修改别名
3. **验证 JSON 格式** - 确保是有效的 JSON
4. **使用唯一的别名** - 避免冲突和混淆

## 🐛 故障排查

| 问题 | 解决方案 |
|------|--------|
| 找不到关键词 | 检查 `alias-config.json` 中的 `keyword` 拼写 |
| 别名不生效 | 检查别名是否在 `aliases` 数组中 |
| JSON 格式错误 | 使用 JSON 验证工具检查 |
| 无法保存配置 | 检查文件权限和路径 |

## 📚 相关文档

- [详细改动说明](./ALIAS_REFACTOR.md)
- [迁移总结](./MIGRATION_SUMMARY.md)
