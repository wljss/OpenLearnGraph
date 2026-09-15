export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
      .replace(/^Error invoking remote method '[^']+': /, '')
      .replace(/^Error: /, '');
  }
  return '发生了未知错误';
}
