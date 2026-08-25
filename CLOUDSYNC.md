# CLOUDSYNC.md — Self-Hosted Cloud Sync (архитектура)

> Статус: **ОТЛОЖЕНО** (решение от 2026-08-25). План готов к реализации, когда дойдём до мульти-девайс синхронизации.

Цель: профили хранятся в облаке; каждый юзер поднимает свой self-host сервер и получает доступ с разных устройств.

## 1. Общая модель

```
┌──────────────┐     HTTPS      ┌─────────────────────┐     HTTPS     ┌──────────────┐
│  Device A    │◄──────────────►│   Sync Server       │◄─────────────►│  Device B    │
│  (Windows)   │   token auth   │  (VPS юзера, Docker)│  token auth   │  (Laptop)    │
│              │                │                     │               │              │
│ Local API    │                │ ┌─────────────────┐ │               │ Local API    │
│ + Sync Agent │                │ │ SQLite (метаданные)│ │              │ + Sync Agent │
│              │                │ │ Blobs (файлы)    │ │               │              │
└──────────────┘                │ └─────────────────┘ │               └──────────────┘
                                └─────────────────────┘
```

Принцип: сервер — единственный источник истины (centralized), не P2P. Для антидетекта критично: профиль должен работать только на одном устройстве одновременно (лизинг), иначе сессии/фингерпринт ломаются.

## 2. Что синхронизируем

| Категория | Синхронизируется | Как |
|---|---|---|
| Метаданные | Профили, группы, прокси, фингерпринт-конфиги, cookies_json | Строки БД (JSON) |
| Данные профиля | Cookies, Local Storage, IndexedDB, Sessions, Login Data (пароли), Preferences, расширения профиля | tar.zst отфильтрованного user-data-dir |
| Расширения | Бинарники расширений | Content-addressed (по SHA-256, грузится 1 раз) |
| ❌ НЕ синхронизируем | Cache, Code Cache, GPUCache, логи, temp | Исключаются фильтром |

## 3. Sync Server (пакет `server/`)

- Стек: Node.js + Fastify + SQLite (тот же стек), один Docker-контейнер + standalone-бинарник
- Деплой:
  ```yaml
  services:
    sync:
      image: antidetect/sync-server:latest
      ports: ["8443:8443"]
      volumes: ["./sync-data:/data"]
      environment:
        - ADMIN_PASSWORD=${ADMIN_PASSWORD}
  ```
- Хранение: SQLite (метаданные) + файловая система (блобы, content-addressed). Бэкап = скопировать папку.
- TLS: через Caddy/nginx (инструкция в доке).

## 4. API v1

```
POST /auth/login            { username, password } → { user_token }
POST /auth/device           { user_token, device_name } → { device_token }
GET  /sync/manifest         → { profiles: [{id, updated_at, hash, lease}], ext_hashes }
GET  /sync/profile/:id/meta |  PUT /sync/profile/:id/meta
GET  /sync/profile/:id/blob |  PUT /sync/profile/:id/blob   (tar.zst, chunked + sha256)
POST /sync/profile/:id/lease/acquire → 200 { lease } | 409 { held_by_device }
POST /sync/profile/:id/lease/release
GET  /ext/:hash             |  PUT /ext/:hash
```

## 5. Ключевые механики

- **Лизинг на профиль**: запуск = lease/acquire (N минут, heartbeat-автопродление). Второе устройство получает 409 «профиль открыт на Device A». Офлайн > lease → «orphaned», при конфликте — безопасная развилка (копия).
- **Поток**: START: manifest → remote новее? скачать blob → распаковать в user-data-dir → acquire lease → запуск. STOP: graceful close → упаковать diff → PUT blob + meta → release lease.
- **Локально-первый**: без сервера всё работает как сейчас; синк — фоновая надстройка.

## 6. Безопасность

1. Транспорт: HTTPS + device-токены с отзывом
2. E2E-шиифрование (опция): блобы и cookies_json шифруются на клиенте (Argon2id + XChaCha20-Poly1305) — сервер видит только ciphertext
3. Пароли прокси: DPAPI локально + E2EE при синке
4. Аудит-лог: кто/когда брал lease

## 7. UI

- Settings → «Sync»: URL сервера, логин, устройства, E2EE-пароль (опция)
- В таблице профилей индикатор: ☁ synced / ↑ local changes / ⏳ downloading / 🔒 open on Device A
- «Sync now» + автосинк после остановки профиля

## 8. Этапы

| Этап | Объём | Результат |
|---|---|---|
| P1 | Sync-server (auth, manifest, meta), Docker, клиент: подключение, синк метаданных | Профили видны на всех устройствах |
| P2 | Блобы профилей (tar.zst), chunked upload, лизинг, скачивание при старте / выгрузка при стопе | Полноценная мульти-девайс работа |
| P3 | E2EE, индикаторы синка, конфликты, отзыв устройств | Продакшн-качество |
