import SwiftUI
import UIKit
import WebKit

// MARK: - 连接信息（与安卓/鸿蒙端一致：host/port/token）

struct ConnectionInfo: Identifiable, Codable, Equatable {
    var id: String { "\(host):\(port)" }
    var host: String
    var port: String
    var token: String
    var name: String
}

// MARK: - 本地持久化（UserDefaults + JSON，密钥只保存在本机）

enum Prefs {
    private static let key = "last_connection"
    private static let defaults = UserDefaults.standard

    static func load() -> ConnectionInfo? {
        guard let raw = defaults.string(forKey: key),
              let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ConnectionInfo.self, from: data)
    }

    static func save(_ info: ConnectionInfo) {
        if let data = try? JSONEncoder().encode(info) {
            defaults.set(String(data: data, encoding: .utf8), forKey: key)
        }
    }

    static func clear() {
        defaults.removeObject(forKey: key)
    }
}

// MARK: - 远程接口（/api/info 连接预检、/api/tasks 新建任务、二维码内容解析）

enum RemoteAPI {
    /// 连接预检：GET /api/info，4 秒超时；返回 (是否可达, 失败原因)。与安卓端行为一致。
    static func checkAlive(host: String, port: String, token: String,
                           completion: @escaping (Bool, String) -> Void) {
        guard let url = URL(string: "http://\(host):\(port)/api/info") else {
            completion(false, "地址格式不正确")
            return
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 4
        req.setValue(token, forHTTPHeaderField: "X-Auth-Token")
        URLSession.shared.dataTask(with: req) { _, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    completion(false, "连不上电脑：\(error.localizedDescription)")
                } else if let http = response as? HTTPURLResponse {
                    if http.statusCode == 200 {
                        completion(true, "")
                    } else if http.statusCode == 401 {
                        completion(false, "访问密钥不正确（401），请到电脑端远程控制页面核对")
                    } else {
                        completion(false, "电脑端返回 \(http.statusCode)")
                    }
                } else {
                    completion(false, "无有效响应")
                }
            }
        }.resume()
    }

    /// 新建任务：POST /api/tasks（密钥只放在请求头，不进 URL）
    static func postTask(host: String, port: String, token: String, text: String,
                         completion: @escaping (Bool, String) -> Void) {
        guard let url = URL(string: "http://\(host):\(port)/api/tasks") else {
            completion(false, "地址格式不正确")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 8
        req.setValue(token, forHTTPHeaderField: "X-Auth-Token")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = ["text": text]
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        URLSession.shared.dataTask(with: req) { data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    completion(false, error.localizedDescription)
                    return
                }
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                if code == 200 {
                    completion(true, "已发送到电脑端")
                } else if code == 503 {
                    completion(false, "电脑端主窗口未运行")
                } else {
                    completion(false, "发送失败（\(code)）")
                }
            }
        }.resume()
    }

    /// 解析二维码内容：支持桌面端二维码的 http://host:port/?t=xx 与 deepwork:// 连接串
    static func parseQR(_ text: String) -> ConnectionInfo? {
        let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = s.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            guard let url = URL(string: s), let host = url.host else { return nil }
            let port = url.port.map(String.init) ?? "3777"
            let items = URLComponents(string: s)?.queryItems ?? []
            let token = items.first(where: { $0.name == "t" || $0.name == "token" })?.value ?? ""
            guard !token.isEmpty else { return nil }
            return ConnectionInfo(host: host, port: port, token: token, name: "电脑端")
        }
        if lower.hasPrefix("deepwork://") {
            guard let url = URL(string: s),
                  let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
            let get = { (name: String) in items.first(where: { $0.name == name })?.value ?? "" }
            let host = get("host"), port = get("port"), token = get("token")
            guard !host.isEmpty, !token.isEmpty else { return nil }
            return ConnectionInfo(host: host, port: port.isEmpty ? "3777" : port, token: token, name: "电脑端")
        }
        return nil
    }

    /// 网页地址：同时携带 t 与 token 两种参数，兼容桌面端页面不同的读取方式
    static func webURL(host: String, port: String, token: String) -> URL? {
        var comp = URLComponents(string: "http://\(host):\(port)/")
        comp?.queryItems = [URLQueryItem(name: "t", value: token),
                            URLQueryItem(name: "token", value: token)]
        return comp?.url
    }
}

// MARK: - WKWebView 封装（自定义 UA 便于电脑端识别 iOS 客户端；主文档失败显示错误页）

struct RemoteWebView: UIViewRepresentable {
    let url: URL
    let onFail: (String) -> Void

    func makeUIView(context: Context) -> WKWebView {
        let wv = WKWebView(frame: .zero)
        // iOS Safari 基准 UA + 客户端标识（与安卓/鸿蒙端追加标识的做法一致）
        wv.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 " +
            "DeepWorkRemote/1.0 (iOS)"
        wv.allowsBackForwardNavigationGestures = true
        wv.navigationDelegate = context.coordinator
        wv.load(URLRequest(url: url))
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: RemoteWebView
        init(_ parent: RemoteWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?,
                     withError error: Error) {
            parent.onFail(friendly(error))
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
            parent.onFail(friendly(error))
        }

        private func friendly(_ e: Error) -> String {
            let ns = e as NSError
            if ns.domain == NSURLErrorDomain {
                switch ns.code {
                case .cannotFindHost: return "找不到电脑地址，请检查 IP 是否正确"
                case .cannotConnectToHost: return "无法连接电脑（端口未开放或被防火墙拦截）"
                case .timedOut: return "连接超时，请确认电脑端已开启远程控制"
                default: break
                }
            }
            return ns.localizedDescription
        }
    }
}

// MARK: - 首页：连接表单（玻璃卡片 + 预检确认，交互与安卓端一致）

struct ContentView: View {
    @State private var host = ""
    @State private var port = "3777"
    @State private var token = ""
    @State private var connecting = false
    @State private var connected: ConnectionInfo?
    @State private var hint: String?
    @State private var showAlert = false
    @State private var failReason = ""
    @State private var pendingInfo: ConnectionInfo?

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.55, green: 0.85, blue: 0.78),
                                    Color(red: 0.45, green: 0.58, blue: 0.95)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    VStack(spacing: 6) {
                        Text("DeepWork 远程")
                            .font(.system(size: 30, weight: .bold))
                            .foregroundStyle(.white)
                        Text("连接电脑端，模型与任务都在网页中管理")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.85))
                    }
                    .padding(.top, 28)

                    glassCard {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("电脑地址")
                                .font(.caption).foregroundStyle(.secondary)
                            TextField("例如 192.168.1.10", text: $host)
                                .textFieldStyle(.plain)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()

                            Divider()
                            Text("端口")
                                .font(.caption).foregroundStyle(.secondary)
                            TextField("3777", text: $port)
                                .textFieldStyle(.plain)
                                .keyboardType(.numberPad)

                            Divider()
                            Text("访问密钥")
                                .font(.caption).foregroundStyle(.secondary)
                            HStack {
                                SecureField("电脑端远程控制页面可查看", text: $token)
                                    .textFieldStyle(.plain)
                                Button {
                                    pasteFromClipboard()
                                } label: {
                                    Text("粘贴")
                                        .font(.footnote.bold())
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            }
                        }
                    }

                    if let hint {
                        Text(hint)
                            .font(.footnote)
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        connect()
                    } label: {
                        HStack {
                            if connecting { ProgressView().tint(.white) }
                            Text(connecting ? "正在连接…" : "连接")
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(.white.opacity(0.9), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .foregroundStyle(.black.opacity(0.85))
                    }
                    .disabled(connecting)

                    Text("安全说明：密钥只保存在本机，连接时通过局域网直达电脑端；\n模型管理、任务列表等完整功能在连接后的网页中操作。")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.75))
                        .multilineTextAlignment(.center)
                }
                .padding()
            }
        }
        .onAppear(perform: restore)
        .fullScreenCover(item: $connected) { info in
            ConnectedView(info: info, onDisconnect: { connected = nil })
        }
        .alert("无法连接到电脑", isPresented: $showAlert) {
            Button("仍要加载网页") {
                if let info = pendingInfo { enterWeb(info) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text(failReason)
        }
    }

    // MARK: 子视图

    private func glassCard<V: View>(@ViewBuilder content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 8) { content() }
            .padding(18)
            .background(.ultraThinMaterial,
                        in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    // MARK: 行为

    private func restore() {
        if let saved = Prefs.load() {
            host = saved.host
            port = saved.port
            token = saved.token
        }
    }

    private func pasteFromClipboard() {
        guard let s = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines),
              !s.isEmpty else {
            hint = "剪贴板为空"
            return
        }
        if let info = RemoteAPI.parseQR(s) {
            host = info.host
            port = info.port
            token = info.token
            hint = "已识别剪贴板中的连接信息"
        } else {
            token = s
            hint = "已粘贴为密钥"
        }
    }

    private func connect() {
        let h = host.trimmingCharacters(in: .whitespacesAndNewlines)
        var p = port.trimmingCharacters(in: .whitespacesAndNewlines)
        if p.isEmpty { p = "3777"; port = p }
        let t = token.trimmingCharacters(in: .whitespacesAndNewlines)

        if h.isEmpty { hint = "请填写电脑地址"; return }
        if t.isEmpty { hint = "请填写访问密钥"; return }
        hint = nil

        let info = ConnectionInfo(host: h, port: p, token: t, name: "电脑端")
        connecting = true
        RemoteAPI.checkAlive(host: h, port: p, token: t) { alive, reason in
            connecting = false
            if alive {
                enterWeb(info)
            } else {
                // 与安卓端一致：预检失败先询问，用户可选择仍加载网页
                pendingInfo = info
                failReason = reason + "\n\n可以返回检查电脑端设置，或仍尝试加载网页。"
                showAlert = true
            }
        }
    }

    private func enterWeb(_ info: ConnectionInfo) {
        Prefs.save(info)
        pendingInfo = nil
        connected = info
    }
}

// MARK: - 连接后：顶部玻璃栏 + 网页 + 新建任务悬浮按钮

struct ConnectedView: View {
    let info: ConnectionInfo
    let onDisconnect: () -> Void

    @State private var showNewTask = false
    @State private var failed: String?
    @State private var reloadToken = UUID()

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    onDisconnect()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.headline)
                        .frame(width: 36, height: 36)
                        .background(.ultraThinMaterial, in: Circle())
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("电脑端").font(.headline)
                    Text("\(info.host):\(info.port)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial)

            ZStack {
                if let url = RemoteAPI.webURL(host: info.host, port: info.port, token: info.token) {
                    RemoteWebView(url: url, onFail: { failed = $0 })
                        .id(reloadToken)
                        .ignoresSafeArea(edges: .bottom)
                }

                if let failed {
                    errorOverlay(failed)
                        .padding(30)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .overlay(alignment: .bottomLeading) {
            Button {
                showNewTask = true
            } label: {
                Label("新建任务", systemImage: "plus")
                    .font(.subheadline.bold())
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .shadow(radius: 6, y: 2)
            }
            .padding(.leading, 18)
            .padding(.bottom, 24)
        }
        .sheet(isPresented: $showNewTask) {
            NewTaskSheet(info: info)
        }
    }

    private func errorOverlay(_ reason: String) -> some View {
        VStack(spacing: 14) {
            Text("⚠️").font(.system(size: 52))
            Text("无法连接到电脑").font(.title2.bold())
            Text("请确认 \(info.host):\(info.port) 可达：\n· 手机与电脑在同一局域网\n· 电脑端已开启远程控制\n· 防火墙未拦截该端口\n\n\(reason)")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            HStack(spacing: 12) {
                Button("重试") {
                    failed = nil
                    reloadToken = UUID()
                }
                .buttonStyle(.borderedProminent)
                Button("返回") { onDisconnect() }
                    .buttonStyle(.bordered)
            }
        }
        .padding(26)
        .background(.ultraThinMaterial,
                    in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

// MARK: - 新建任务（与安卓端一致：POST /api/tasks）

struct NewTaskSheet: View {
    let info: ConnectionInfo
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("把任务发给电脑端执行：")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                TextEditor(text: $text)
                    .frame(minHeight: 120)
                    .padding(8)
                    .background(Color(.secondarySystemBackground),
                                in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
                Spacer()
            }
            .padding()
            .navigationTitle("新建任务")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "发送中…" : "发送") { send() }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func send() {
        sending = true
        RemoteAPI.postTask(host: info.host, port: info.port, token: info.token, text: text) { ok, msg in
            sending = false
            if ok {
                dismiss()
            } else {
                error = msg
            }
        }
    }
}
