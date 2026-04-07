# 新增功能：聊天记录删除

## 功能说明

在 `index.ts` 中增加了被保存者本人删除记录的功能，允许用户删除属于自己的保存记录。

## 核心特性

### ✅ 被保存者可以删除自己的记录
- **操作方式**: 用户回复某条自己被保存的截图，回复内容为"删除"
- **验证机制**: Bot 检查申请删除的人是否是该记录的被保存人（上传者）
- **执行结果**: 如果验证通过，删除该图片文件及其元数据记录

### ✅ 元数据管理系统
创建了 `records-config.json` 来记录：
- `groupId`: 群组 ID
- `recordedUserId`: 被保存人的用户 ID（即上传者）
- `recordedUserName`: 被保存人的用户名
- `keyword`: 保存的关键词（对应的文件夹）
- `files`: 该用户在该关键词下的所有图片列表

### ✅ 配置开关
在 Config 中添加 `enableRecordDelete` 配置项，默认启用，可关闭此功能。

## 实现细节

### 新增接口
```typescript
interface RecordConfig {
    groupId: string
    recordedUserId: string      // 被保存人的 ID
    recordedUserName: string    // 被保存人的名字
    keyword: string             // 关键词（对应文件夹）
    files: {
        filename: string
        uploadTime: number
    }[]
}
```

### 新增函数

| 函数名 | 作用 |
|-------|------|
| `getRecordsConfigPath()` | 获取记录配置文件路径 |
| `loadRecordsConfig()` | 加载聊天记录配置 |
| `saveRecordsConfig()` | 保存聊天记录配置 |
| `findRecordByFile()` | 查找文件所属的记录 |

### 工作流程

#### 保存截图时：
1. 用户上传图片并指定关键词
2. 系统保存图片文件到对应文件夹
3. 系统自动记录上传者的 ID、用户名、关键词等信息
4. 更新 `records-config.json`

#### 删除记录时：
1. 用户回复某条图片，发送"删除"
2. Bot 检测到"删除"关键字和被引用消息
3. 系统查询该图片所属的记录
4. 验证当前用户是否是被保存人（recordedUserId）
5. 如果验证通过：
   - 删除图片文件
   - 从配置中移除该文件记录
   - 如果该记录下无文件，删除整个记录
   - 返回删除成功消息
6. 如果验证失败，返回错误消息

## 配置示例

### 启用删除功能
```yaml
enableRecordDelete: true  # 默认值：true
```

### 禁用删除功能
```yaml
enableRecordDelete: false
```

## records-config.json 格式示例

```json
[
  {
    "groupId": "123456789",
    "recordedUserId": "user_123",
    "recordedUserName": "Alice",
    "keyword": "记录1",
    "files": [
      {
        "filename": "2024-01-15-10-30-45-1-user_123.png",
        "uploadTime": 1705310445000
      },
      {
        "filename": "2024-01-15-10-35-22-2-user_123.png",
        "uploadTime": 1705310522000
      }
    ]
  }
]
```

## 用户体验流程

### 场景示例

1. **保存记录**
   ```
   用户A: /添加 rem
   用户A: [上传截图]
   Bot: 保存成功了喵~，现在有 5 张图片呢~
   ```
   → 系统自动记录用户A为被保存人

2. **查看记录** 
   ```
   用户A: /查看列表
   Bot: rem   有5张图片
   ```

3. **删除记录**
   ```
   用户A: [回复某条图片]
   用户A: 删除
   Bot: 已删除您的 1 条图片记录喵~
   ```

## 权限说明

- ✅ **只有被保存人能删除**: 只有上传者（recordedUserId）可以删除自己的记录
- ✅ **支持多语言删除指令**: 支持"删除"、"delete"、"删"三种方式
- ✅ **需要被引用消息**: 删除操作必须回复图片消息

## 注意事项

1. **删除规则**: 系统删除该用户在该关键词下最近上传的一张图片
2. **配置持久化**: 所有删除都会立即写入 `records-config.json`
3. **错误处理**: 如果找不到对应的记录，会给出提示消息
4. **级联删除**: 如果某用户在某关键词下的所有图片都被删除，该记录会自动移除

## 故障排查

| 问题 | 解决方案 |
|------|--------|
| "没有找到属于您的图片记录" | 检查是否是该图片的上传者 |
| 删除功能不生效 | 检查 `enableRecordDelete` 是否为 true |
| records-config.json 不存在 | 首次保存图片时会自动创建 |

## 相关文件

- `src/index.ts` - 主要实现文件
- `records-config.json` - 聊天记录元数据存储
- `alias-config.json` - 别名配置（不受影响）
