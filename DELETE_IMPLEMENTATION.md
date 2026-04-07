# index.ts 删除功能改动总结

## 📋 改动清单

### 1. 配置接口扩展
- ✅ 添加 `enableRecordDelete: boolean` 配置项（默认 true）

### 2. 新增数据结构

#### RecordConfig 接口
```typescript
interface RecordConfig {
    groupId: string
    recordedUserId: string      // 被保存人 ID
    recordedUserName: string    // 被保存人名字
    keyword: string             // 关键词
    files: {
        filename: string
        uploadTime: number
    }[]
}
```

### 3. 新增函数

| 函数 | 功能 |
|------|------|
| `getRecordsConfigPath()` | 获取记录配置路径 |
| `loadRecordsConfig()` | 加载记录配置 |
| `saveRecordsConfig()` | 保存记录配置 |
| `findRecordByFile()` | 查找文件所属记录 |

### 4. 核心逻辑改动

#### 存图指令修改
- ✅ 增加 `savedFilenames` 数组来记录已保存的文件名
- ✅ 保存文件后，自动记录到 `records-config.json`
- ✅ 记录包含用户 ID、用户名、关键词、上传时间等信息

#### 新增删除中间件
- ✅ 监听"删除"、"delete"、"删"关键字
- ✅ 验证删除申请人是否是被保存人
- ✅ 删除符合条件的图片文件
- ✅ 更新元数据配置
- ✅ 返回删除结果消息

### 5. 文件结构

```
images/
├── keyword1/
│   ├── file1.jpg
│   ├── file2.png
│   └── ...
├── keyword2/
│   └── file3.jpg
├── alias-config.json      # 别名配置（原有）
└── records-config.json    # 新增：记录元数据
```

## 🔄 工作流程

```
用户上传截图
    ↓
系统保存图片文件
    ↓
记录用户、关键词、文件名等信息到 records-config.json
    ↓
用户回复该图片 + 发送"删除"
    ↓
系统检查删除人是否为被保存人
    ↓
验证通过 → 删除文件 + 更新配置 → 返回成功消息
验证失败 → 返回错误消息
```

## 📊 数据流

### 保存阶段
```
Input: 用户上传截图 → 指定关键词
↓
Processing:
  1. 降样/校验文件
  2. 生成文件名
  3. 写入磁盘
  4. 记录元数据
↓
Output: records-config.json 更新
```

### 删除阶段
```
Input: 用户发送"删除" + 回复图片
↓
Processing:
  1. 解析被引用消息
  2. 查询记录配置
  3. 验证用户身份
  4. 删除文件 + 更新配置
↓
Output: 删除成功/失败消息
```

## 🎯 关键特性

✅ **用户隐私保护**: 只有上传者能删除自己的记录  
✅ **数据持久化**: 元数据同步保存到 JSON  
✅ **灵活删除**: 支持多种删除指令  
✅ **自动清理**: 删除最后一个文件时自动删除配置项  
✅ **可配置**: 可通过开关启用/禁用此功能  

## 📝 代码量

- ✅ 新增配置项：1 个
- ✅ 新增接口：1 个
- ✅ 新增函数：4 个
- ✅ 新增中间件：1 个 (约 100 行)
- ✅ 修改指令：存图指令
- ✅ 新增配置文件：records-config.json

## ⚙️ 兼容性

- ✅ 向后兼容：不影响现有的存图和发图功能
- ✅ 独立系统：records-config.json 独立于 alias-config.json  
- ✅ 可选功能：可通过 `enableRecordDelete: false` 完全禁用

## 🚀 使用示例

### 启用删除功能
```yaml
enableRecordDelete: true
```

### 禁用删除功能
```yaml
enableRecordDelete: false
```

## 📖 相关文档

- [DELETE_FEATURE.md](./DELETE_FEATURE.md) - 完整功能说明
- [ALIAS_REFACTOR.md](./ALIAS_REFACTOR.md) - 别名系统说明
- [MIGRATION_SUMMARY.md](./MIGRATION_SUMMARY.md) - 总体改动说明
