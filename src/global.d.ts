// 原版有 MACRO 全局常量；我们通过 bun build --define 注入字面量，
// 这里只保留类型声明
declare const MACRO: {
  VERSION: string
  BUILD_TIME: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string | undefined
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  VERSION_CHANGELOG: string
}
