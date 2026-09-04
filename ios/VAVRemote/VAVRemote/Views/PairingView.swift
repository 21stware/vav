import SwiftUI

/// First-run pairing, or add another computer from Settings.
/// Scan the QR from VAV → 设置 → 连接, or paste the payload by hand.
struct PairingView: View {
    enum Mode {
        case firstRun
        case add
    }

    var mode: Mode = .firstRun
    @EnvironmentObject private var client: RemoteClient
    @Environment(\.dismiss) private var dismiss
    @State private var manualText = ""
    @State private var failed = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if mode == .firstRun {
                    VStack(spacing: 10) {
                        Image("BrandMark")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 72, height: 72)
                        Text("VAV Remote")
                            .font(.title2.weight(.semibold))
                    }
                    .padding(.top, 8)
                }

                ScannerView { code in adopt(code) }
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .frame(maxHeight: 360)
                    .padding(.horizontal)

                Text(hint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                HStack {
                    TextField("或粘贴 vav-remote: / vav-daemon:// 配对串", text: $manualText)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    Button("配对") { adopt(manualText) }
                        .buttonStyle(.borderedProminent)
                        .disabled(manualText.isEmpty)
                }
                .padding(.horizontal)

                if failed {
                    Text("配对串无效，请重试。")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
                Spacer()
            }
            .padding(.top)
            .navigationTitle(mode == .add ? "添加电脑" : "配对")
            .navigationBarTitleDisplayMode(mode == .add ? .inline : .large)
            .toolbar {
                if mode == .add {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") { dismiss() }
                    }
                }
            }
        }
    }

    private var hint: String {
        switch mode {
        case .firstRun:
            return "在电脑上打开 VAV → 设置 → 连接，扫描二维码，或粘贴 vavd 打印的配对 URI。"
        case .add:
            return "扫描另一台电脑上的配对二维码。已保存的电脑不会被覆盖。"
        }
    }

    private func adopt(_ text: String) {
        guard let pairing = Pairing.parse(text.trimmingCharacters(in: .whitespacesAndNewlines))
        else {
            failed = true
            return
        }
        failed = false
        client.adopt(pairing: pairing)
        if mode == .add { dismiss() }
    }
}
