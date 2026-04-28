import Foundation
import Capacitor
import MediaPlayer

extension MPVolumeView {
    // Synchronous volume set — no async delay. The 10ms dispatchAfter in
    // the upstream version creates a window where rapid button presses
    // are silently dropped. We need the press -> reset cycle to be tight.
    static func setVolume(_ volume: Float) {
        let volumeView = MPVolumeView()
        let slider = volumeView.subviews.first(where: { $0 is UISlider }) as? UISlider
        if Thread.isMainThread {
            slider?.value = volume
        } else {
            DispatchQueue.main.async { slider?.value = volume }
        }
    }
}

/**
 * PATCHED for uglyduckhunt:
 *  - Keep system volume permanently centered at 0.5 so neither edge
 *    (max=1.0, min=0.0) is ever reached. Reaching an edge is what causes
 *    the upstream plugin to drop ~10% of presses and occasionally fire
 *    the OPPOSITE direction during the reset.
 *  - Reset is performed inline on the same KVO callback that fired the
 *    event, with an `isResetting` guard so the reset itself doesn't get
 *    interpreted as another button press.
 */
@objc(CapacitorVolumeButtonsPlugin)
public class CapacitorVolumeButtonsPlugin: CAPPlugin {
    private let implementation = CapacitorVolumeButtons()
    private let centerLevel: Float = 0.5
    private var audioLevel: Float = 0.5
    private var isResetting: Bool = false

    override public func load() {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setActive(true, options: [])
            audioSession.addObserver(self, forKeyPath: "outputVolume",
                                     options: NSKeyValueObservingOptions.new, context: nil)
            isResetting = true
            MPVolumeView.setVolume(centerLevel)
            audioLevel = centerLevel
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                self?.isResetting = false
            }
        } catch {
            print("Error loading CapacitorVolumeButtonsPlugin")
        }
    }

    public override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?, context: UnsafeMutableRawPointer?) {
        guard keyPath == "outputVolume" else { return }
        if isResetting { return }

        let audioSession = AVAudioSession.sharedInstance()
        let newLevel = audioSession.outputVolume

        if newLevel > audioLevel {
            self.notifyListeners("volumeButtonPressed", data: ["direction": "up"])
        } else if newLevel < audioLevel {
            self.notifyListeners("volumeButtonPressed", data: ["direction": "down"])
        } else {
            return
        }

        // After every press, snap back to the center so the next press
        // (in either direction) is guaranteed to register.
        isResetting = true
        MPVolumeView.setVolume(centerLevel)
        audioLevel = centerLevel
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.04) { [weak self] in
            self?.isResetting = false
        }
    }
}
