# ArkTS 编码规范要求

**⚠️ 最高优先级强制要求**：所有代码设计和实现必须严格遵循ArkTS编码规范，确保生成的代码天然符合ArkTS类型检查要求。

**获取方式**：通过Skill工具调用arkts-standards skill获取完整的ArkTS编码规范文档和最佳实践。

## 核心规范要求

在进行代码设计和实现之前，先调用arkts-standards skill获取完整的编码规范，然后按照规范要求进行设计。

## 1. 类图设计必须包含类型定义

在设计类图时，必须为所有属性和方法明确类型：

```typescript
// ✅ 正确的类设计
class UserService {
  private users: Map<number, UserInfo>;  // 明确定义类型
  private config: ServiceConfig;         // 明确定义类型

  constructor(config: ServiceConfig) {
    this.config = config;
    this.users = new Map();
  }

  getUserById(id: number): UserInfo | null {  // 明确定义返回类型
    return this.users.get(id) || null;
  }

  addUser(user: UserInfo): void {  // 明确定义参数类型
    this.users.set(user.id, user);
  }
}

// ✅ 必须先定义接口
interface UserInfo {
  id: number;
  name: string;
  email: string;
}

interface ServiceConfig {
  apiUrl: string;
  timeout: number;
}
```

## 2. 时序图设计必须包含类型信息

在时序图中，所有方法调用和参数传递都必须明确类型：

```typescript
// ✅ 正确的时序图设计
// UI层 -> 业务层
const user: UserInfo = await userService.getUserById(userId);

// 业务层 -> 数据层
const response: ApiResponse<UserInfo> = await apiClient.get(`/users/${id}`);

// 数据层返回
return response.data;
```

## 3. 代码功能实现设计必须包含类型定义

在列举文件修改信息时，必须包含类型定义：

**错误示例**（必须避免）：
```typescript
// ❌ 直接使用对象字面量
function getUser() {
  return { id: 1, name: 'John' };
}

// ❌ 使用any类型
function processData(data: any) {
  return data.value;
}
```

**正确设计方式**：
```typescript
// ✅ 先定义接口
interface User {
  id: number;
  name: string;
}

// ✅ 明确定义返回类型
function getUser(): User {
  return { id: 1, name: 'John' };
}

// ✅ 明确定义参数类型
interface ProcessData {
  value: string;
  timestamp: number;
}

function processData(data: ProcessData): string {
  return data.value;
}
```

## 4. 组件设计必须定义Props类型

**错误示例**（必须避免）：
```typescript
// ❌ Props使用未类型化对象
@Component
struct MyComponent {
  @Prop props: {
    title: string;
    count: number;
  };
}
```

**正确设计方式**：
```typescript
// ✅ 先定义Props接口
interface MyComponentProps {
  title: string;
  count: number;
  onClick?: () => void;
}

// ✅ 使用接口定义Props
@Component
struct MyComponent {
  @Prop props: MyComponentProps;
}
```

## 5. API设计必须定义请求和响应类型

**错误示例**（必须避免）：
```typescript
// ❌ 使用any类型
async function fetchUser(id: number): Promise<any> {
  const response = await fetch(`/api/users/${id}`);
  return await response.json();
}

// ❌ 请求参数使用未类型化对象
function updateUser(id: number, data: any): Promise<any> {
  return fetch(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}
```

**正确设计方式**：
```typescript
// ✅ 定义请求和响应类型
interface UserUpdateRequest {
  name?: string;
  email?: string;
  age?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
}

// ✅ 使用明确类型
async function fetchUser(id: number): Promise<ApiResponse<UserInfo>> {
  const response = await fetch(`/api/users/${id}`);
  return await response.json();
}

// ✅ 请求参数使用明确类型
function updateUser(id: number, data: UserUpdateRequest): Promise<ApiResponse<UserInfo>> {
  return fetch(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}
```

## 6. 事件处理设计必须定义事件类型

**错误示例**（必须避免）：
```typescript
// ❌ 事件参数使用any
onClick(event: any): void {
  console.log(event.target);
}
```

**正确设计方式**：
```typescript
// ✅ 定义事件类型
interface ClickEvent {
  target: Element;
  currentTarget: Element;
  preventDefault: () => void;
  stopPropagation: () => void;
}

// ✅ 使用明确的事件类型
onClick(event: ClickEvent): void {
  console.log(event.target);
}
```

## 7. 设计文档类型检查清单（强制执行）

在设计文档中，必须确保：

- [ ] 所有类图中的属性都有明确类型
- [ ] 所有类图中的方法都有明确的参数和返回值类型
- [ ] 所有时序图中的方法调用都有明确的参数和返回值类型
- [ ] 所有组件都定义了Props接口
- [ ] 所有API调用都定义了请求和响应类型
- [ ] 所有事件处理都定义了事件类型
- [ ] 没有使用any类型
- [ ] 没有使用unknown类型
- [ ] 所有对象字面量都有对应的接口或类定义

## 8. 代码实现时的类型要求

在第六步"基于设计文档完成代码的实现"时，必须：

1. **先定义类型**：在实现功能之前，先定义所有需要的接口和类型
2. **使用类型**：所有变量、参数、返回值都必须使用已定义的类型
3. **验证类型**：编译验证时检查是否有类型错误
4. **修复类型问题**：如果发现类型问题，必须立即修复

**⚠️ 重要**：设计和实现都必须严格遵循ArkTS编码规范，确保生成的代码天然符合类型检查要求，避免后续需要大量修复类型问题。