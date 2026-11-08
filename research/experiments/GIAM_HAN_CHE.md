# Cách giảm các hạn chế của nghiên cứu

Không xóa hết được các hạn chế trong thời gian thi. Mục tiêu là đo được mức độ, giảm phần quan trọng nhất, và nói rõ phần còn lại.

## Hạn chế lớn nhất, mới phát hiện: nhãn trùng với nguồn dữ liệu

Trong bộ v2, ca nguy hiểm gần như đều là chuyển thể, ca bình thường gần như đều tự viết hoặc AI sinh. Mô hình đoán được nguồn đúng 90,8% chỉ từ chữ ([EXP-006](EXP-006/README.md)). Vì vậy số của mô hình trên bộ này chưa đáng tin, và check không phát hiện được vì có cùng lỗi.

**Cách giảm:** tạo **cặp đối chứng**. Với mỗi ca lừa đảo, viết một ca bình thường cùng văn phong, cùng độ dài, cùng chủ đề, chỉ khác điểm then chốt, ví dụ cùng là tuyển CTV nhưng không đòi nạp tiền. Cả hai phải cùng người viết và dùng cùng kiểu dữ liệu giả.

**Trạng thái (2026-11-07):** chưa có bộ cặp đối chứng dùng để đo, nên hạn chế này **chưa được giải quyết**. Bộ nháp đầu tiên, do AI hỗ trợ soạn và người sửa, đã lộ với phía viết luật nên chỉ dùng làm nguồn gợi ý luật, không đo và không báo số trên đó. Đang chờ cặp viết tay mới.

Khi đọc bộ nháp đó, nhóm thấy luật dễ báo nhầm khi cùng văn phong, nhất là câu phủ định và tin nói về chiều tiền ngược lại. Vì vậy số báo nhầm trên bộ v2 có thể thấp hơn thực tế.

## Sáu hạn chế đã biết

| # | Hạn chế | Cách giảm | Trạng thái |
|---:|---|---|---|
| 1 | Bộ v2 chưa độc lập | Bộ đề kín do người không viết luật soạn từ bài báo mới. Dùng SMS test đã khóa làm nguồn ngoài | Việc của Danh và Đạt, 15 ca |
| 2 | Nhãn | Người chưa tham gia gán lại khi không thấy nhãn cũ. Hai người bất đồng thì người thứ ba quyết định, không mặc định theo A. Báo κ riêng từng nguồn. Ghi đúng nguồn của ca AI sinh | Đã có phiếu ẩn nhãn. Đã tính κ theo nguồn ([label_audit.json](label_audit.json)). Chờ người gán |
| 3 | Mẫu nhỏ | Báo khoảng tin cậy và so từng cặp thay vì so tỷ lệ. Không kết luận khi chênh dưới 3 ca. Thêm cặp đối chứng để tăng mẫu | Đã có so từng cặp trong sổ thí nghiệm |
| 4 | Đo trên dữ liệu đã đọc | Tách tune/check, ghi số lần xem check, chọn trên tune rồi mới xác nhận. Số cuối lấy từ test khóa và bộ kín | Đã có sổ thí nghiệm |
| 5 | Không suy rộng | Thử kịch bản chưa thấy bằng cách bỏ hẳn một nhóm khi xây dựng. Giữ riêng bài báo đăng sau ngày đóng băng làm bộ thử theo thời gian | Đã thử trên mô hình. Bộ theo thời gian chờ người soạn |
| 6 | Phân tích nguyên nhân chủ quan | Người thứ hai xếp độc lập khoảng 10 lỗi rồi so kết quả. Tăng phần đo tự động như vùng phủ, tỷ lệ theo luật | Có phần đo tự động. Chờ người đọc |

## Ai làm gì, theo thứ tự hiệu quả

| Ưu tiên | Việc | Người | Thời gian ước tính |
|---:|---|---|---:|
| 1 | Viết 15–20 cặp đối chứng cùng văn phong | Đạt hoặc Danh, không phải người viết luật | 1,5 giờ |
| 2 | Gán lại khoảng 30 ca bằng phiếu ẩn nhãn, gồm cả mốc | Danh | 1 giờ |
| 3 | Soạn bộ kín 15 ca từ bài báo mới | Đạt | 1 giờ |
| 4 | Đọc lại 10 lỗi, xếp nguyên nhân độc lập | Danh hoặc Đạt | 20 phút |
| 5 | Chạy so sánh AI trên tune, xác nhận trên check, cặp đối chứng và bộ kín | Duy | Sau khi có khóa Groq |

Phiếu ẩn nhãn nằm ở `research/results/labeling/phieu_gan_nhan_doc_lap.csv` trên máy Duy, vì có nội dung hội thoại nên chỉ gửi qua kênh riêng. Người viết luật không dùng phiếu này.

## Khi báo cáo

Nêu rõ số lần xem check trong sổ thí nghiệm, nêu cả các hướng đã thất bại, và chỉ gọi là kết quả độc lập cho phần chạy trên bộ kín hoặc test đã khóa.
