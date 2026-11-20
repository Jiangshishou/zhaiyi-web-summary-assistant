// 运行时消息的错误响应判定：跨内容层与后台层的唯一实现。
// 纯函数、零依赖，可被 content / background 共用而不引入额外运行时耦合。
export function isErrorResponse(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "string"
  );
}
