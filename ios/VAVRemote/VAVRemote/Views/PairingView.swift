import SwiftUI

/// First-run pairing: scan the QR from VAV → 设置 → 通知 → 远程控制,
/// or paste the payload by hand (simulator / no camera).
struct PairingView: View {
    @EnvironmentObject private var client: RemoteClient
    @State private var manualText = ""
    @State private var failed = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                VStack(spacing: 10) {
                    Image("BrandMark")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 72, height: 72)
                    Text("VAV Remote")
                        .font(.title2.weight(.semibold))
                }
                .padding(.top, 8)

                ScannerView { code in adopt(code) }
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .frame(maxHeight: 360)
                    .padding(.horizontal)

                Text("在 Mac 上打开 VAV → 设置 → 通知 → 远程控制，扫描配对二维码。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                HStack {
                    TextField("或粘贴 vav-remote:… 配对串", text: $manualText)
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
            .navigationTitle("配对")
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
    }
}
