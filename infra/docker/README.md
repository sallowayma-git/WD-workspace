# API image

API 容器镜像定义将在数据库迁移与认证基线稳定后加入。镜像必须使用非 root 用户、固定 Java 21 runtime、只读文件系统策略和 SBOM；当前不生成未验证的生产 Dockerfile。
