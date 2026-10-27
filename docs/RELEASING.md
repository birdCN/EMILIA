# 发布

## 发布前检查

1. 运行 npm test 和 node --test installer/tests/*.test.mjs。
2. 更新 package.json、package-lock.json 和 CHANGELOG.md 中的版本信息。
3. 检查 .gitignore，排除 .env、runtime/、.venv/、work/ 和模型文件。
4. 检查依赖许可，以及新增图片、字体、声音和模型的分发权限。
5. 确认源码与示例数据中不含密钥或私人信息。

## 创建仓库

在 GitHub 创建空仓库，然后在项目目录执行：

```powershell
git init
git add .
git status
git diff --cached --stat
git commit -m "Initial release"
git branch -M main
git remote add origin YOUR_REPOSITORY_URL
git push -u origin main
```

将 YOUR_REPOSITORY_URL 替换为仓库地址。首次提交前应检查暂存文件。

## 创建版本

```powershell
git tag v1.3.4
git push origin v1.3.4
```

在 GitHub Releases 中填写版本说明。源码、安装包和模型资源应分别标明适用平台、依赖及许可证。

Windows 安装包使用 `installer/build.ps1` 构建。发布 Setup EXE 与 SHA-256 文件；不要把已安装目录、下载缓存或个人档案打包。至少在干净的 Windows 环境中完成一次下载、首次配置、语音对话与卸载验收，并记录测试系统和硬件。详见 [Windows 安装版](WINDOWS_INSTALLER.md)。
