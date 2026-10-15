# Hugging Face Space entry point: the service itself is installed from requirements.txt
import os

if os.environ.get("SPACES_ZERO_GPU"):
    # Free Gradio Spaces now run on ZeroGPU, which stops an app that never reports a
    # @spaces.GPU function. The report normally fires on gradio's launch(); this service
    # serves its own API, so it reports directly. The analysis itself runs on CPU.
    import spaces
    from spaces.zero import startup

    @spaces.GPU
    def _zerogpu_placeholder():
        return None

    startup()

from openstock_analyst.server import main

main()
