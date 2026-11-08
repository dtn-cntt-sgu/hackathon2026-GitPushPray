# EXP-028: Giữ bằng chứng khi gộp nạp tiền vào kẹt lệnh

- **Ngày:** 2026-11-07
- **Cách suy luận:** rules
- **Commit:** `0360ea5+dirty`
- **Tập đã khóa:** `a2ac7dfce966`
- **Xem check:** không

## Giả thuyết

Giữ bằng chứng của lần đòi nạp đầu khi gộp vào tín hiệu kẹt lệnh, để nhận ra người dùng đã nạp, không đổi mức các tập đo

## Thay đổi

Phát hiện khi soạn hội thoại thử cho AI: khi có `task_freeze_extortion`, tín hiệu `task_deposit` bị bỏ vì trùng nghĩa, mất luôn bằng chứng của lần đòi nạp đầu. Tin "em vừa nạp xong" nằm giữa hai lần đòi nên bị coi là nói trước khi có yêu cầu, `user_complied_money` không bật. Nay bằng chứng của `task_deposit` được gộp vào `task_freeze_extortion`. Thêm tình huống 224.

## Kết quả

| Kiểm tra | EXP-027 | EXP-028 |
|---|---:|---:|
| Tune: đúng mức, bỏ sót, báo nhầm Cao+ | 44/65, 1/31, 3/32 | 44/65, 1/31, 3/32 |
| SMS lừa đảo: Cao+, có cảnh báo | 33,9%, 61,1% | 33,9%, 61,1% |
| SMS thường: Cao+, có cảnh báo | 4,0%, 5,2% | 4,0%, 5,2% |
| Tình huống cố định | 223/223 | 224/224 |

## Kết luận

**Đạt.** Sửa lỗi thứ tự bằng chứng, mức cảnh báo không đổi.

## Tái lập

```bash
git checkout 0360ea5
```

```bash
npm run bench:experiment -- --id <mã mới> --title "tái lập EXP-028" --hypothesis "tái lập" --method rules
```
