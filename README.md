# clawd-usage

Claude Code 的 mod：在輸入框上方常駐一條額度框，顯示 5 小時與 7 天的用量百分比和重設倒數。

Claude 工作時，Clawd 會從框左邊出發，在框前面一路跑到最右邊，戴上帽子跳三下，帽子掉了再回頭跑回原位。框和框裡的文字固定不動，只有 Clawd 會動。

## 安裝

在 Claude Code 終端機的輸入框打：

```
/plugin install clawd-usage --marketplace a0303031-dot/clawd-usage
```

接著按 `y` 加入 marketplace，再選安裝範圍。

從 shell 安裝：

```
claude plugin install clawd-usage --marketplace a0303031-dot/clawd-usage
```

在桌面 App（`/plugin` 不能用的地方）：按輸入框旁的 +，選 Plugins，用 Add marketplace 加入 `a0303031-dot/clawd-usage`，再按 Add plugin。

裝好後開新對話就會出現。

## 說明

- 額度數字來自這個對話最近一次 Claude 回應，每回合結束時更新。其他對話用掉的額度，要等這個對話下次送出訊息才會反映。
- 只有訂閱方案有 5 小時與 7 天額度，用 API key 時框裡會顯示等待字樣。
- 支援桌面 App 的 Code 分頁、終端機與 VS Code。Cowork 不會顯示。
