import SwiftUI
import UIKit

struct DiagExportView: View {
    let url: URL

    var body: some View {
        NavigationStack {
            ShareLink(item: url) {
                Label("系统分享 / 隔空投送 / 文件", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .padding()
            .navigationTitle("导出日志")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
