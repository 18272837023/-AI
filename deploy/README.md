# Ubuntu 部署配置

这些文件是部署配置，不代表服务器已安装完成。部署前需实际连接目标主机并检查已有服务、端口与磁盘空间。

## 目录与运行方式

- `/opt/ai-tender/releases/<提交号>/`：完整仓库源码及安装后的服务端依赖，由管理员维护。
- `/opt/ai-tender/current`：指向当前版本的符号链接，回退时切回旧版本。
- `/opt/ai-tender/runtime/`：Node.js LTS 运行环境，含 `bin/node` 和 `bin/npm`。
- `/etc/ai-tender/server.env`：服务器配置，管理员可读，权限 `0600`；从 `server.env.example` 创建并单独填写模型密钥，不进入 Git。
- `/var/lib/ai-tender/`：项目数据库、上传文件与编辑数据；更新代码时保持此目录不变。
- `/usr/local/share/fonts/fandol/`：开源中文字体及随附许可证。

服务使用独立系统账户 `ai-tender`，由 systemd 托管，监听 `127.0.0.1:5310`。配置中限制了文件写入位置和内存使用量，队列并发设置为 1，适合 2 核 2 GiB 的单用户试用实例。

在选定的源码版本 `server` 目录执行 `npm ci --omit=dev`。安装 `ai-tender.service` 到 `/etc/systemd/system/`，通过 `systemctl enable --now ai-tender` 启动；用 `journalctl -u ai-tender` 检查运行日志。环境文件需先创建，数据目录需归 `ai-tender` 所有。

## Linux PDF 字体

从 [CTAN Fandol 项目](https://ctan.org/pkg/fandol) 安装以下开源字体，并保留 `COPYING` 与 `README`：

| 界面选项 | Linux 字体文件 |
|---|---|
| 宋体 | `FandolSong-Regular.otf` |
| 黑体 | `FandolHei-Regular.otf` |
| 仿宋 | `FandolFang-Regular.otf` |

这是同类中文字体在 Linux 上的实现，与 Windows 中易字体的字形和排版可能略有差异。Word 保留用户选择的字体名称；PDF 嵌入所配置的服务器字体。

默认目录为 `/usr/local/share/fonts/fandol`，也可通过 `PDF_FONT_DIR` 改变。需要指定其他有使用权的字体时，可配置 `PDF_FONT_SONG`、`PDF_FONT_HEI`、`PDF_FONT_FANG` 文件路径；TTC 字体集合另设对应的 `_FAMILY` 名称。

## 入口与验证

`nginx-loopback.conf` 是仅本机可访问的初始代理配置。公网入口须先配置 HTTPS 和访问控制；当前产品是共享项目数据的单用户版本。不要直接开放 5310 端口。用户的域名及证书方案确认后，再建立独立的公网虚拟主机，不覆盖服务器原有站点。

部署后应验证：健康接口、统一前端入口、上传与完整生成流程、人工保存、Word 和三种中文字体的 PDF 导出；重启服务后再检查数据仍可读取。真实 AI 验证单独使用合成文件，不搬运本机历史招标原件与测试项目。

健康接口为 `GET http://127.0.0.1:5310/v1/health`。系统服务可通过 `systemctl restart ai-tender` 重启；更新前先保存 `/var/lib/ai-tender` 与环境配置的受保护备份。
