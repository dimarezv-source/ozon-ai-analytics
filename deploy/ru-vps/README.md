# Российский VPS: параллельный запуск

Эта конфигурация поднимает приложение, PostgreSQL 18 и Caddy. Она не меняет Render и не содержит секретов. Внешние порты приложения и БД не публикуются: доступны только 80/443; SSH настраивается отдельно.

## Ограничение текущей версии

Tenant/session endpoints существуют, но аналитические маршруты ещё не полностью tenant-scoped и используют legacy dashboard login и глобальные Ozon credentials. Это только staging. Не добавляйте Ozon API credentials и не подключайте пользователей/магазины до завершения изоляции доступа. Не используйте production API key с правами записи.

## Требования

- Ubuntu 24.04 LTS или актуальная поддерживаемая Ubuntu, публичный IPv4.
- 1 vCPU / 1 GB RAM / 10 GB SSD — очень тесно; возможны OOM и медленные сборки.
- Для стабильной эксплуатации рекомендуются минимум 2 vCPU / 4 GB RAM / 40 GB NVMe.
- DNS A-запись домена указывает на IPv4 VPS; входящие TCP 80/443 открыты.
- Docker Engine и Compose plugin.

## Установка

1. Подключитесь к серверу по SSH. Создайте отдельного пользователя с sudo, запретите SSH password login после проверки ключевого входа.
2. Установите Docker Engine и Compose plugin по официальной инструкции Docker для Ubuntu. Добавьте пользователя в группу docker только если принимаете эквивалент root-доступа.
3. Клонируйте приватный GitHub-репозиторий в /opt/ozon-ai-analytics с deploy key, имеющим только read access. Не используйте персональный токен в URL клонирования.
4. Скопируйте deploy/ru-vps/.env.example в deploy/ru-vps/.env; задайте домен, email и уникальные секреты. Ограничьте доступ: chmod 600 deploy/ru-vps/.env.
5. Запустите из каталога репозитория:

~~~sh
docker compose --env-file deploy/ru-vps/.env -f deploy/ru-vps/compose.yaml up -d --build
~~~

6. Проверьте контейнеры и endpoint /health по HTTPS.
7. Настройте резервное копирование вне VPS. Локальный backup на том же сервере не защищает от потери VPS.

## Backup / restore

Из каталога deploy/ru-vps:
- ./backup.sh — custom-format dump PostgreSQL, проверка списка объектов, локальная ротация 14 дней.
- ./restore.sh backups/имя-файла.dump — требует явного ввода RESTORE и перезаписывает объекты БД.

Сделайте скрипты исполняемыми: chmod 700 backup.sh restore.sh. Перед production migration создайте финальный backup, проверьте восстановление на пустой staging DB и сравните counts/schema. Не удаляйте Render DB и сервис.

## Firewall

Разрешите SSH только с доверенных IP, плюс TCP 80/443. Не открывайте 5432 и 8000 наружу. Настройте unattended security updates и контроль свободного места.

## Cutover

DNS и Render не переключать до security review, проверки всех API маршрутов, восстановления backup, проверки сессий за HTTPS reverse proxy и согласования окна переключения. На данный момент это staging, не готовый multi-tenant production.
