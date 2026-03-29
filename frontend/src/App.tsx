import { useState } from "react";
import { checkDbHealth } from "./api";
import "./styles.css";

function App() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("点击按钮测试数据库连接");

  const handleCheck = async () => {
    setLoading(true);
    try {
      const data = await checkDbHealth();
      setMessage(`数据库连接成功，select 1 结果: ${data.result}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "未知错误";
      setMessage(`数据库连接失败: ${errMsg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container">
      <h1>LiveSetList</h1>
      <button onClick={handleCheck} disabled={loading}>
        {loading ? "查询中..." : "测试数据库(select 1)"}
      </button>
      <p>{message}</p>
    </main>
  );
}

export default App;
