# TypeSafe Jev 1.14 (OpenRouter): как с ней работать для сигналов

Изучено и проверено живыми запросами 2026-11-03.

## Что это за модель

- `typesafe/jev-1.14` (снимок `typesafe/jev-1.14-20261014`, вышла 14.10.2026) — **не LLM**, а «decision»-модель (System One от TypeSafe).
- Текста не пишет вообще: ни объяснений, ни JSON, ни reasoning. Возвращает **типизированный ответ с вероятностями**.
- Вход: текст + картинки (PNG/JPEG). Контекст 262 144 токена.
- Цена: только входные токены, $0.042 / 1M; выход бесплатный. Скриншот 1280×640 ≈ 2 620 токенов ≈ **$0.00011 за запрос** (~$0.11 за 1000 сигналов).
- Скорость в тестах: **1.3–1.7 с** на запрос со скриншотом (Qwen через chat/completions — десятки секунд).

## Endpoint — НЕ chat/completions

```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer <OpenRouter key>   (тот же ключ, что в landing/ai-secret.php)
```

Нет `messages`, `temperature`, `max_tokens`, `response_format`, `reasoning`, массива `models` с фолбэком.
Тело запроса: `model`, `state`, `questions` (+ необязательно `provider`, `user`, `session_id`).
API помечен как alpha — формат может меняться. Альтернатива: `POST /api/v1/systemone` (для TypeSafe SDK), там то же самое.

## Типы вопросов (primitives)

| Тип | Вопрос | Ответ |
|-|-|-|
| `choice` | какой из вариантов? | `choice`, `probabilities` по каждому, `confidence` |
| `noul` | верно ли утверждение? | `noul` = вероятность «да» (0..1) |
| `score` | где на упорядоченной шкале? | `score` (взвешенная позиция, 0 = первый пункт), `probabilities`, `confidence`, `legend` |
| `box` | где на картинке объект? | `box {top,bottom,left,right}` в долях, `confidence` (только Jev 1.14) |

Все вопросы одного запроса отвечаются параллельно и не видят ответы друг друга. Задавать несколько вопросов в одном запросе выгодно: картинка оплачивается один раз.

## Запрос для сигнала (проверен)

```json
{
  "model": "typesafe/jev-1.14",
  "state": [
    "Screenshot of a live 1-minute candlestick price chart from a trading platform. The newest candle is on the right.",
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
  ],
  "questions": {
    "is_chart": { "type": "noul", "instructions": "The image is a candlestick price chart." },
    "direction": {
      "type": "choice",
      "instructions": "Where will the price most likely be one minute after the last candle on the chart, compared with the last close?",
      "criteria": {
        "up": "Higher than the last close.",
        "down": "Lower than the last close.",
        "neutral": "About the same: the market is flat or the picture gives no edge."
      }
    },
    "trend": {
      "type": "score",
      "instructions": "Direction of the recent trend on the chart.",
      "criteria": ["Strong downtrend", "Weak downtrend", "Sideways", "Weak uptrend", "Strong uptrend"]
    }
  }
}
```

Ответ:

```json
{
  "id": "gen-dec-...",
  "model": "typesafe/jev-1.14-20261014",
  "provider": "TypeSafe",
  "answers": {
    "is_chart":  { "type": "noul", "noul": 0.98 },
    "direction": { "type": "choice", "choice": "neutral",
                   "probabilities": { "up": 0.28, "down": 0.35, "neutral": 0.37 }, "confidence": 0.06 },
    "trend":     { "type": "score", "score": 3.26, "confidence": 0.38,
                   "probabilities": { "0": 0, "1": 0.09, "2": 0.15, "3": 0.17, "4": 0.59 }, "legend": { "0": "Strong downtrend", "...": "..." } }
  },
  "usage": { "input_tokens": 2620, "output_tokens": 69, "cost": 0.00011004 }
}
```

Модель берётся из ответа (`model`); `state` — массив, где текст это **просто строки** (не `{type:"text"}`), картинка — `image_url` с data URL.

## Ограничения на картинку (важно для нашего захвата)

- Только `image/png` и `image/jpeg` (webp — отказ; `ai.php` сейчас пропускает webp).
- Каждая сторона **256–1568 px**, всего 78 400–2 458 624 пикселей. Меньше — `400`, больше — `413`.
  У нас `CHART_RECT_JS` принимает канвас от 240×160, а `ai.php` — от 200×120 → низкий график надо **дорастить до 256** (масштаб или поля), иначе 400.
  Ширина ужимается до 1280 — укладывается.
- Удалённые URL не скачиваются, только base64 data URL.
- Запросы с картинкой всегда идут в «long-context mode» у TypeSafe — по их словам, медленнее и менее точно, чем текстовые. Работа с картинками у них помечена как ранняя функция.

## Ошибки

`400` неверный запрос/размер картинки · `401` ключ · `402` нет кредитов · `413` слишком большая картинка · `429` лимит · `502` провайдер упал · `524` таймаут.
Тело ошибки: `{"error": {"code": ..., "message": "..."}}`.

## Результаты теста (synthetic M1, EUR/USD OTC, 60 свечей, 1280×640 JPEG)

| График | trend (score 0..4) | direction | вероятности up / down / neutral | confidence | время |
|-|-|-|-|-|-|
| рост | 3.26 (strong up 0.59) | neutral | 0.28 / 0.35 / 0.37 | 0.06 | 1652 мс |
| падение | 0.51 (strong down 0.60) | neutral | 0.25 / 0.34 / 0.41 | 0.11 | 1326 мс |
| случайное блуждание (закончилось подъёмом) | 3.12 (weak up 0.59) | up | 0.39 / 0.31 / 0.30 | 0.09 | 1450 мс |

`is_chart` 0.96–0.98 во всех трёх.

**Вывод:** что на графике (тренд), модель видит правильно. На вопрос «куда пойдёт цена через минуту» она честно отвечает «не знаю»: вероятности почти равные, confidence 0.06–0.11. На синтетике это правильный ответ — случайное блуждание непредсказуемо по построению, — так что этот тест **не измеряет** реальную точность.

## Как использовать в боте

1. Модель жёстко фиксировать `typesafe/jev-1.14`, не `~typesafe/jev-latest`: пороги подбираются под конкретную версию.
2. Решение принимать по порогам, а не по полю `choice`:
   торговать UP, только если `probabilities.up ≥ P` **и** `confidence ≥ C`; аналогично DOWN; иначе — пропуск.
   `is_chart.noul < 0.8` → не торговать.
3. P и C подбирать только по данным: на демо логировать каждый запрос (вероятности, confidence, цену входа) и цену через 60 с, затем считать winrate при разных порогах.
4. Ориентир безубыточности: при выплате 85 % нужен winrate > 1 / 1.85 ≈ **54.1 %** на сделках, прошедших порог. Пока по логам этого нет — авто-сделки на реале не включать.
5. Текста (summary, сигналы, поддержка/сопротивление), который сейчас рисует AI-панель, Jev не даёт. Варианты: оставить Qwen для объяснения, а Jev — для решения, или убрать эти поля из UI для режима робота.

## Подключение в Q-bot PLUS

Цепочка: робот (`main/deal.js`) → событие `qbot-jev-signal-request` → `electron/preload.js` → `qbot-jev-signal` в `electron/main.js` (снимок графика, подгонка под 256–1568 px) → `landing/ai.php` (`action: "signal"`) → Jev.

- Включается режимом **(OTC) Trading** (`deal-otc: "ON"`): в OTC все сигналы, включая перезапрос в AI-мартингейле, даёт только Jev. Без OTC работает прежний сервер сигналов. Jev работает только в приложении: в Chrome-расширении ответа не будет («Jev: нет ответа»).
- Работает на любом счёте, демо и реальном; в журнал пишется, на каком счёте был сигнал (`demo`).
- Каждый сигнал пишется в `landing/jev-log.php`: вероятности, confidence, направление, время, цена. Итог **первой** сделки по сигналу (win/loss/refund) робот отправляет `action: "outcome"`. Шаги мартингейла в статистику не попадают.

Настройки в `landing/ai-secret.php` (все необязательные):

```php
"limits" => [..., "signal" => 1500],          // сигналов в день на установку
"jev" => [
  "model" => "typesafe/jev-1.14",
  "min_prob" => 0, "min_conf" => 0,           // 0 = калибровка: каждый график даёт UP или DOWN
  "min_chart" => 0.8,                         // ниже — «это не график», WAIT
  "payout" => 0.85,                           // выплата для расчёта безубыточности
  "report_key" => "<длинная случайная строка>",
],
```

Отчёт: `https://ai-tradebot.com/qbotplus/ai.php?report=<report_key>` или `php ai.php report`.
В `by_threshold` для каждой пары порогов: число сделок, winrate, `winrate_low95` (нижняя граница 95 %) и `edge`.
`edge: true` ставится, только когда даже `winrate_low95` выше безубыточности (54.1 % при выплате 85 %). Тогда эти пороги можно прописать в `min_prob` / `min_conf`.

Тестовый скрипт (временный, вне репозитория): `C:\Users\West\AppData\Local\Temp\claude\C--Users-West-Desktop------------Q-bot-PLUS\6f7cc1d3-8267-4772-b042-6fc2a6f5b105\scratchpad\jev_test.py` — генерирует графики и шлёт их в Decisions API.
Запуск: `python jev_test.py landing/ai-secret.php <папка для картинок>`.
