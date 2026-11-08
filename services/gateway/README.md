# Gateway

Phụ trách: **Danh**, nhánh `danh/gateway-aws`.

AI Gateway chạy **local trước** (Hono trên Node, gọi Groq `openai/gpt-oss-120b`), có thể đóng gói lên AWS Lambda + API Gateway HTTP API khi chuyển giai đoạn. Rule engine của `@safechat/core` vẫn là tầng 0; gateway chỉ gọi AI để bổ sung tín hiệu, **không lưu nội dung chat**.

## Endpoint

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| GET | `/healthz` | Kiểm tra sống, provider và prompt version |
| GET | `/readyz` | Kiểm tra sẵn sàng: đọc được store và có khóa model khi bật AI |
| POST | `/v1/devices` | Cấp token HMAC ngắn hạn cho thiết bị |
| POST | `/v1/analyses` | Phân tích delta, gọi Groq, kiểm tra trích dẫn |
| POST | `/v1/feedback` | Ghi feedback không kèm nội dung tin nhắn |
| GET | `/v1/metrics/summary` | Số liệu tổng hợp, cần admin token |

## Cấu trúc

```
services/gateway/
  src/app.ts              Hono app: CORS, body limit, logging, lỗi
  src/index.ts            Lambda handler + server local
  src/routes/             devices, analyses, feedback, metrics
  src/lib/config.ts       env/secrets, default an toàn
  src/lib/auth.ts         token HMAC sc1.<payload>.<sig>
  src/lib/validate.ts     zod schema cho request
  src/lib/text.ts         làm sạch, mask PII, ước lượng token
  src/lib/taxonomy.ts     canonical type + synonym
  src/lib/guards.ts       stage, downgrade, summary, PII
  src/lib/prompt.ts       output contract, prompt theo tier
  src/lib/ddb.ts          bộ đếm DynamoDB / memory cho test
  src/lib/limits.ts       rate, quota ngày, budget token
  src/lib/metrics.ts      counter + histogram ẩn danh
  src/lib/providers/      groq, none (kill switch)
  build.mjs               esbuild bundle ESM cho Lambda
  tests/                  Vitest
```

## Biến môi trường

Bắt buộc:

- `TABLE_NAME`: bảng DynamoDB chỉ chứa bộ đếm.
- `TOKEN_SECRET` hoặc `TOKEN_SECRET_ARN`: secret ký token thiết bị.
- `AI_PROVIDER`: `groq` hoặc `none` (mặc định `none`).

Tùy chọn:

- `TOKEN_SECRET_PREVIOUS` / `TOKEN_SECRET_PREVIOUS_ARN`: secret cũ khi xoay vòng.
- `GROQ_API_KEY` / `GROQ_SECRET_ARN`: bắt buộc khi `AI_PROVIDER=groq`.
- `ADMIN_TOKEN_SECRET_ARN`: bắt buộc nếu dùng `/v1/metrics/summary`.
- `GROQ_MODEL_SMALL`, `GROQ_MODEL_LARGE` (mặc định `openai/gpt-oss-120b` cho cả hai tầng).
- `GROQ_COST_PER_1K_INPUT_USD=0.00015`, `GROQ_COST_PER_1K_OUTPUT_USD=0.00075`: giá dùng để tính chi phí trong metrics; cập nhật khi Groq đổi giá.
- `AI_TIMEOUT_SMALL_MS`, `AI_TIMEOUT_LARGE_MS`.
- `AI_CONTEXT_MESSAGES=8`, `AI_MAX_NEW_MESSAGES=50`.
- `AI_MAX_INPUT_CHARS`, `AI_MAX_INPUT_TOKENS`, `AI_MAX_SIGNALS`, `AI_ESCALATION`.
- `DEVICE_RPM=4`, `DEVICE_DAILY_CALLS=50`, `DEVICE_ISSUE_RPM=10`.
- `GLOBAL_RPM=20`, `GLOBAL_DAILY_CALLS=500`, `GLOBAL_DAILY_TOKENS=2000000`.
- `MAX_BODY_BYTES=262144`, `TOKEN_TTL_HOURS=24`.
- `ALLOWED_ORIGINS`, `PROMPT_VERSION`.

Không đặt secret trong biến môi trường trần khi deploy; dùng ARN Secrets Manager.

## Token thiết bị

- Dạng `sc1.<base64url(payload)>.<hmac-sha256>`.
- Payload `{ v, c, d, iat, exp }`: version, client, device id, thời điểm cấp/hết hạn.
- TTL mặc định 24 giờ, cho phép lệch 60 giây.
- Khi xoay vòng, đặt secret cũ vào `TOKEN_SECRET_PREVIOUS` để token cũ còn hạn vẫn dùng được.

## Bảo vệ dữ liệu

- Không log tin nhắn, prompt, trích dẫn hay token. Lỗi parse/model chỉ ghi `errorCode`, không ghi `detail` vì có thể chứa nguyên văn chat.
- PII được mask trước khi gửi model; `ruleHints.title` cũng được mask. Số điện thoại, số tài khoản, email bị che; số tiền (ví dụ `9.600.000đ`) được giữ để model hiểu ngữ cảnh.
- Nội dung do người dùng nhập được escape trước khi đưa vào prompt.
- Trích dẫn AI phải khớp nguyên văn tin gốc và đủ số lượng; nếu không, tín hiệu bị loại.
- AI **không thể tự đẩy lên Nghiêm trọng**: mọi tín hiệu `critical` từ model bị hạ xuống `high`, `direct_danger=false`. Rule engine vẫn có thể đặt mức Nghiêm trọng.
- AI được **hạ tối đa 1 bậc** so với mức rule engine và không bao giờ hạ từ Nghiêm trọng.
- Tín hiệu AI trùng ý nghĩa với bộ luật (kể cả khác tên, ví dụ `money_transfer` ≈ `fee_upfront`) bị loại để không tính điểm hai lần. Khi bộ luật còn Thấp/Cần chú ý, severity của tín hiệu AI không nguy hiểm bị kẹp theo mức hiện tại; tin OTP chỉ kèm lời dặn "không chia sẻ" không bị coi là yêu cầu OTP.
- Leo tầng `small → large` dùng prompt riêng của tầng `large` và phải reserve thêm token; nếu hết ngân sách thì giữ kết quả lượt nhanh.

## Chạy local và kiểm tra

```bash
# Terminal 1: gateway local (không cần AWS)
AI_PROVIDER=groq \
TOKEN_SECRET="$(node -e "console.log('x'.repeat(40))")" \
GROQ_API_KEY=<key-của-nhóm> \
PORT=8787 \
npm run dev:gateway

curl http://localhost:8787/healthz
curl http://localhost:8787/readyz
```

Có thể chép `.env.example` thành `services/gateway/.env` (hoặc `.env` ở gốc repo) rồi chạy `npm run dev:gateway`; server local tự nạp file này. Không có `TABLE_NAME` thì gateway dùng store trong bộ nhớ (đủ cho demo một tiến trình). Khi có DynamoDB, đặt `TABLE_NAME` và cấp quyền tối thiểu.

```bash
npm test
npm run typecheck
npm run build:gateway
```

`npm run build:gateway` tạo `services/gateway/dist/index.js` (ESM) và `package.json` để Lambda hiểu module.

## Triển khai (AWS, hoãn)

- Hạ tầng: `infra/template.yaml` (AWS SAM, stack `safechat-staging` / `safechat-prod`, vùng `ap-northeast-1`).
- CI: `.github/workflows/ci.yml` (typecheck, test, eval, build extension, build gateway; gitleaks ở job security; chưa cấu hình ESLint nên không chạy lint giả).
- CD: `.github/workflows/deploy.yml` (OIDC, build bundle, copy vào `infra/gateway-dist`, deploy staging + smoke test `/healthz` `/readyz`; job production chạy khi tag `v*`). Workflow chỉ chạy khi đặt `vars.DEPLOY_AWS=true`; giai đoạn local-first để trống.
- Chi phí: `ReservedConcurrency`, API Gateway throttling và AWS Budgets có tham số trong `infra/template.yaml`.

Cần cấu hình GitHub secrets: `AWS_ROLE_ARN`, `AWS_REGION`, `TOKEN_SECRET_ARN`, `GROQ_SECRET_ARN`; tùy chọn `TOKEN_SECRET_PREVIOUS_ARN`, `ADMIN_TOKEN_SECRET_ARN`, `ALLOWED_ORIGINS`, `PROMPT_VERSION`. Biến thường dùng `vars`: `AI_PROVIDER`, `GROQ_MODEL_SMALL`, `GROQ_MODEL_LARGE`, `RESERVED_CONCURRENCY`, `API_THROTTLE_RATE_LIMIT`, `API_THROTTLE_BURST_LIMIT`, `MONTHLY_BUDGET_USD`.

Không commit access key, tài khoản hay giá trị bí mật.
