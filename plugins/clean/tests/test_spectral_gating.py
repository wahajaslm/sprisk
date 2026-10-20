import polars as pl
from sprisk_clean.spectral_gating import spectral_gating


def test_spectral_gating_attenuates_low_snr():
    train = pl.DataFrame({
        "speech_signal": [1.0, 0.5, 0.2, 0.1],
        "snr_db": [12.0, 6.0, -5.0, -10.0],
    })
    test = pl.DataFrame({
        "speech_signal": [0.8, 0.05],
        "snr_db": [10.0, -8.0],
    })

    result = spectral_gating(
        train,
        test,
        signal_column="speech_signal",
        snr_column="snr_db",
        threshold_db=0.0,
        attenuation_factor=0.2,
    )

    out_train = result["train"]
    out_test = result["test"]

    # High SNR frames should retain full signal
    assert out_train["speech_signal"][0] == 1.0
    assert out_train["spectral_gate_gain"][0] == 1.0

    # Low SNR frames should be attenuated
    assert out_train["speech_signal"][3] < 0.1
    assert out_train["spectral_gate_gain"][3] >= 0.2

    # Test set processed equivalently
    assert out_test["speech_signal"][0] == 0.8
    assert out_test["speech_signal"][1] < 0.05

    # Real Plotly figure output is provided
    assert "figures" in result
    assert len(result["figures"]) == 1



def test_spectral_gating_test_gain_uses_only_the_train_noise_floor():
    train = pl.DataFrame({"speech_signal": [1.0, 1.0], "snr_db": [-10.0, 5.0]})
    params = dict(signal_column="speech_signal", snr_column="snr_db", threshold_db=0.0, attenuation_factor=0.2)
    alone = pl.DataFrame({"speech_signal": [1.0], "snr_db": [-5.0]})
    with_low_frame = pl.DataFrame({"speech_signal": [1.0, 1.0], "snr_db": [-5.0, -40.0]})

    gain_alone = spectral_gating(train, alone, **params)["test"]["spectral_gate_gain"][0]
    gain_beside_low = spectral_gating(train, with_low_frame, **params)["test"]["spectral_gate_gain"][0]

    assert gain_alone == gain_beside_low
