# AI Tutor 🧠

AI Tutor là một ứng dụng chatbot hiện đại, giàu tính năng, được xây dựng với kiến trúc module hóa: backend sử dụng Python (FastAPI/Flask) và frontend sử dụng React.

![Version](https://img.shields.io/badge/version-1.1.0-green)
![License](https://img.shields.io/badge/license-ISC-blue)

## 🎨 Giao diện hệ thống

Dưới đây là hình ảnh minh họa về giao diện chính của hệ thống AI Tutor:

![AI Tutor Interface](docs/interface.png)

## ✨ Các chức năng chính

- 🧠 **Kiến trúc Module hóa** - Thiết kế backend theo domain-driven (bao gồm 'auth', 'chat', 'llm', v.v.).
- 🔄 **Giao tiếp Real-time** - Hỗ trợ cả **SSE Streaming** và **WebSocket** cho trải nghiệm chat mượt mà.
- 🤖 **Tích hợp LLM đa dạng** - Hỗ trợ nhiều nhà cung cấp LLM như Ollama, OpenAI, Gemini, vLLM thông qua mẫu thiết kế provider.
- 💾 **Lưu trữ dữ liệu** - Sử dụng PostgreSQL với cơ chế dự phòng (fallback) bằng JSON (lưu tại thư mục `/data`).
- 📂 **Quản lý dự án** - Tổ chức các cuộc hội thoại thành các dự án cùng với ngữ cảnh từ tài liệu (hệ thống RAG - Retrieval-Augmented Generation).
- 🛠️ **Hỗ trợ MCP** - Dễ dàng mở rộng tính năng thông qua Model Context Protocol.

## 🚀 Hướng dẫn cấu hình và cài đặt

Để triển khai dự án trên môi trường local, vui lòng làm theo các bước sau:

### Yêu cầu hệ thống (Prerequisites)

- **Python** (phiên bản 3.10 trở lên)
- **Node.js** (phiên bản 18 trở lên)
- **PostgreSQL** (Tùy chọn, hệ thống có thể dùng JSON để thay thế)
- **Redis** (Tùy chọn, dùng để caching)

### Cài đặt

1. **Cài đặt Backend**
   ```bash
   cd server
   python -m venv .venv
   
   # Kích hoạt môi trường ảo:
   # Windows: .venv\Scripts\activate
   # Linux/Mac: source .venv/bin/activate
   
   pip install -r requirements.txt
   ```

2. **Cài đặt Frontend**
   ```bash
   cd ..
   npm install
   ```

### Cấu hình file môi trường

**Cấu hình Backend** (tạo file `server/.env`):
```env
PORT=3000
HOST=0.0.0.0
FRONTEND_URL=http://localhost:5173

# Cấu hình Database
USE_DATABASE=true # Đặt là false nếu muốn dùng file JSON trong thư mục /data
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ai_tutor_db
DB_USER=ai_tutor
DB_PASSWORD=your_password

# Cấu hình LLM
LLM_PROVIDER=ollama
LLM_MODEL=mistral
OLLAMA_BASE_URL=http://localhost:11434/v1
```

**Cấu hình Frontend** (tạo file `.env` ở thư mục gốc):
```env
VITE_API_URL=http://localhost:3000/api
VITE_SOCKET_URL=http://localhost:3000
```

### Chạy ứng dụng

**Terminal 1: Chạy Backend**
```bash
cd server
# Đảm bảo môi trường ảo (venv) đã được kích hoạt
python main.py
```
*Server backend sẽ chạy tại: `http://localhost:3000`*

**Terminal 2: Chạy Frontend**
```bash
# Ở thư mục gốc của dự án
npm run dev
```
*Giao diện frontend sẽ chạy tại: `http://localhost:5173`*

## 📂 Cấu trúc thư mục

```text
ai-tutor-web/
├── server/
│   ├── modules/              # Các module tính năng (auth, chat, llm, mcp, v.v.)
│   ├── common/               # Các tiện ích dùng chung
│   ├── config/               # Thư mục cấu hình
│   ├── testing/              # Script kiểm thử
│   ├── api_router.py         # Router chính của API
│   └── main.py               # Điểm vào (Entry point) của server
├── src/                      # Source code React Frontend
├── data/                     # Lưu trữ dữ liệu JSON và Uploads
├── docs/                     # Tài liệu và hình ảnh (chứa interface.png)
└── README.md
```

---

⭐️ **Nếu bạn thấy dự án này hữu ích, đừng quên cho chúng mình xin 1 star nhé! Cảm ơn bạn rất nhiều!** ⭐️