// 离线子进程保留 Windows/临时目录运行所需环境，不继承真实代理或账户凭据。
export function offlineSubprocessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { BANGUMI_AGENT_PROXY: '' };
  for (const key of ['SystemRoot', 'SystemDrive', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}
