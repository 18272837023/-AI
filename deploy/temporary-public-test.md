# 无自有域名的临时公网调试

使用前需用户同意 Cloudflare 转发测试请求和文件。此配置只用于限时共享测试空间，不是多用户正式服务。

## 运行隔离

独立账户 `ai-tender-test`，源代码 `/opt/ai-tender/external-test`，数据 `/var/lib/ai-tender-external-test`。不得复制原项目数据库、上传文件或编辑结果。服务器密钥配置从原环境安全读取，单独保存为 `/etc/ai-tender/external-test.env`（管理员可读、0600），不得进入 Git。

必须配置：

```dotenv
HOST=127.0.0.1
PORT=5311
DATA_DIR=/var/lib/ai-tender-external-test
UPLOAD_DIR=/var/lib/ai-tender-external-test/uploads
TEST_ACCESS_REQUIRED=1
TEST_ACCESS_TOKEN=至少32位的随机测试凭证
TEST_ACCESS_EXPIRES_AT=替换为本轮测试到期的ISO时间
```

后端必须在首次公开前验证：无凭证/错误凭证均返回 401；凭证有效时可以访问；到期后即使进程仍运行也返回 401。所有请求（包括健康检查、上传、下载和未知路径）均先经过校验，查询字符串不作为凭证。

`nginx-external-test.conf` 只监听本机 8081，仅代理 `/v1/` 到 5311。Cloudflare Quick Tunnel 指向 8081，对外提供临时 HTTPS 地址。后端无须开放公网入站业务端口。

## 小程序接入

在本机调试包的 `app.js/globalData` 设置 `apiBaseUrl` 为本轮临时 HTTPS 地址。实际凭证不得写入小程序源码或随二维码打包。首次请求被拒绝时，客户端弹出输入框，由受邀测试者手动粘贴管理员单独发给他的本轮访问码；验证通过后只存于该设备本地。请求、上传、下载均自动带 `Authorization: Bearer ...`。此凭证只属于本轮共享测试，不是微信登录或独立用户身份，不要提交实际凭证到仓库。

微信侧的测试资格、域名校验和调试设置仍须满足微信要求，临时 HTTPS 域名不会自动获得微信合法域名资格。只有手机实际完成接口请求与上传后，才能确认该手机的扫码链路可用。

## 到期与限制

安装 `ai-tender-test-expire.service`，另生成本轮固定 UTC 到期时间的 `.timer`：`OnCalendar=<UTC时间>`、`Persistent=true`，启动定时器。到期同时停止后端与公网通道，保留测试数据用于排查。后端凭证到期校验是第二道限制。

Quick Tunnel 不自动重启，因为重启会更换网址，需要更新小程序并重新编译二维码。地址、证书、网络连通性及微信放行无法保证；第三方无可用性承诺。分发前从外网验证健康接口、上传、任务轮询和实际下载。仅使用非敏感测试文件，同批测试者共用此测试空间。

配置来源：[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。
