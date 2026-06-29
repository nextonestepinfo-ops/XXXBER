# XXXBER 新環境 利用ガイド

## 使うURL

新環境のURL:

```text
https://nextonestepinfo-ops.github.io/XXXBER/recovery/
```

旧URLは消さずに保管します。今後の入力は新環境URLだけを使ってください。

## すでに入っているデータ

新環境にはCSVから復元した売上が入っています。件数や金額の確認は、公開ページではなく次の新しいスプレッドシートで行ってください。

新しいスプレッドシート:

```text
https://docs.google.com/spreadsheets/d/1I6mEnagIY_ByAwg9vybJZ4SUWgaANiFdbQYgrS3k_EY
```

## 保存先設定

GASのWebアプリURLが発行されたら、最初に各端末で次の形式のURLを一度だけ開いてください。

```text
https://nextonestepinfo-ops.github.io/XXXBER/recovery/?recoveryApi=ここにGASのexec URL
```

一度開くと、その端末に保存先が記録されます。以後は通常の新環境URLで使えます。

## 画面表示の見方

- `本番書込OFF`: 旧本番には書き込んでいません。保存先GASが未設定です。
- `新しい保存先へ保存します`: 新しいスプレッドシートへ保存する設定です。
- `未同期`: 端末内に保存待ちデータがあります。管理者の新環境パネルから出力または再送してください。

## 現場への説明文

今後は新URLだけ使ってください。旧URLは確認用として残しますが、入力には使いません。

もし画面に `本番書込OFF` と出ている場合は、保存先設定がまだなので管理者に連絡してください。
