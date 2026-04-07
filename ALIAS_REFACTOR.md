# index.ts 别名存储改造说明

## 概述
将 `index.ts` 的别名存储方式从**文件夹名称方式**改为**JSON 配置文件方式**，使其与 `main.py` 和 `mapping.json` 的存储逻辑保持一致。

## 核心改动

### 1. 新增 JSON 配置管理
- **文件位置**: `{basePath}/{groupName}/alias-config.json`
- **配置接口**:
  ```typescript
  interface AliasConfig {
    keyword: string    // 主关键词（对应文件夹名）
    aliases: string[]  // 别名列表
  }
  ```

### 2. 关键新增函数
- `getAliasConfigPath(groupName)` - 获取配置文件路径
- `loadAliasConfig(groupName)` - 加载别名配置
- `saveAliasConfig(groupName, config)` - 保存别名配置
- `findKeywordConfig(keyword, groupName)` - 查询关键词配置

### 3. 文件夹结构变化
| 原方式 | 新方式 |
|-------|-------|
| `keyword-alias1-alias2/` | `keyword/` |
| 二级目录在文件夹名中 | 配置存在 JSON 中 |

### 4. 指令改动详情

#### 添加别名指令 (`${config.addAliasCommandName}`)
- **原**: 修改文件夹名称（`keyword-alias1` → `keyword-alias1-alias2`）
- **新**: 直接修改 JSON 配置中的别名数组
- **优点**: 无需文件系统操作，更快更安全

#### 创建关键词指令 (`${config.createCommandName}`)
- **原**: 创建 `keyword-alias1-alias2` 文件夹
- **新**: 创建 `keyword` 文件夹 + 向 JSON 添加配置项
- **优点**: 文件夹名简洁，别名信息集中管理

#### 列表指令 (`${config.listCommandName}`)  
- **原**: 解析文件夹名称中的 `-` 分隔符
- **新**: 直接从 JSON 读取别名列表
- **优点**: 逻辑清晰，性能更好

#### 发图指令 (`${config.sendCommandName}`)
- **原**: 遍历文件夹名称中的别名
- **新**: 遍历 JSON 配置中的别名
- **优点**: 别名查询统一，维护性更强

### 5. 存图指令改动
- 从 JSON 配置中查询关键词，而不是从文件夹名称解析
- 匹配逻辑保持不变

### 6. 刷新指令改动
- **原**: 显示文件夹数量
- **新**: 显示关键词数量（更准确）

## 文件示例

### alias-config.json
```json
[
  {
    "keyword": "2b",
    "aliases": ["二b", "nier", "偶像"]
  },
  {
    "keyword": "rem",
    "aliases": ["蕾姆", "blue_demon"]
  }
]
```

### 对应文件夹结构
```
images/
├── 2b/
│   ├── image1.jpg
│   ├── image2.png
│   └── ...
├── rem/
│   ├── image1.jpg
│   └── ...
└── alias-config.json
```

## 向后兼容性
- 不自动转换旧数据，需要用户手动配置
- 新建的关键词使用新方式
- 建议：删除旧的带别名的文件夹，重新创建

## 优势总结
✅ 与 main.py 逻辑保持一致  
✅ 文件夹名称更简洁  
✅ 别名管理更灵活（无需重命名）  
✅ 配置格式统一（JSON）  
✅ 性能更好（不需解析文件夹名）  
✅ 扩展性更强（可添加更多元数据）
