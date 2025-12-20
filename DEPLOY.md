# Деплой Flash на Fly.io

## Подготовка

1. Установи Fly CLI:
   - Windows: `powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"`
   - Mac/Linux: `curl -L https://fly.io/install.sh | sh`

2. Создай аккаунт и залогинься:
   ```bash
   fly auth signup
   # или если уже есть аккаунт:
   fly auth login
   ```

## Деплой

1. Перейди в папку flash:
   ```bash
   cd flash
   ```

2. Создай приложение (первый раз):
   ```bash
   fly launch --no-deploy
   ```
   - Выбери регион ближе к тебе (например `ams` - Амстердам)
   - На вопрос о базе данных - ответь No
   - На вопрос о Redis - ответь No

3. Установи секретный ключ:
   ```bash
   fly secrets set JWT_SECRET=твой-супер-секретный-ключ-минимум-32-символа
   ```

4. Задеплой:
   ```bash
   fly deploy
   ```

5. Открой сайт:
   ```bash
   fly open
   ```

## Полезные команды

```bash
# Посмотреть логи
fly logs

# Статус приложения
fly status

# Перезапустить
fly apps restart

# Удалить приложение
fly apps destroy flash-messenger
```

## Про звонки

Звонки работают через бесплатные TURN серверы от Metered (OpenRelay).
Они уже настроены в `frontend/js/config.js`.

Если нужны свои TURN серверы:
1. Зарегистрируйся на https://www.metered.ca/
2. Создай TURN credentials
3. Обнови `CONFIG.ICE_SERVERS` в `frontend/js/config.js`

## Важно

- Данные хранятся в памяти и сбрасываются при редеплое
- Для постоянного хранения нужна база данных (PostgreSQL)
- Бесплатный tier Fly.io: 3 shared VMs, 160GB bandwidth
