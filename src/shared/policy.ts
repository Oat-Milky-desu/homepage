/** 账户与口令策略（服务端与前端共享同一套规则） */

export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678',
  '123456789',
  'qwertyuiop',
  'qwerty123',
  'admin12345',
  'administrator',
  'letmein123',
  'iloveyou123',
  'abcd123456',
  'abc12345678',
]);

export function validateUsername(username: string): string | null {
  if (!username) return '用户名不能为空';
  if (!USERNAME_PATTERN.test(username)) {
    return '用户名需为 3-32 位字母、数字、下划线、点或连字符';
  }
  return null;
}

export function validatePassword(password: string, username?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `密码长度至少 ${MIN_PASSWORD_LENGTH} 位`;
  if (password.length > MAX_PASSWORD_LENGTH) return `密码长度不能超过 ${MAX_PASSWORD_LENGTH} 位`;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return '密码过于常见，请更换更复杂的密码';
  if (username && username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
    return '密码不能包含用户名';
  }
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 2) return '密码需包含大小写字母、数字、符号中的至少两类';
  return null;
}
