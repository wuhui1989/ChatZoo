import os

import torch
from transformers import AutoTokenizer, AutoConfig
from transformers.models.auto.modeling_auto import _BaseAutoModelClass

from .chatbot import ChatBOT, no_proxy
from .utils import OVERLENGTH

class TransformersChatBOT(ChatBOT):
    """
    ChatBOT for ``transformers`` models.
    """
    def __init__(self, config):
        super(TransformersChatBOT, self).__init__(config)
        self.max_tokens = 0

    def load_tokenizer(self):
        print("debug", self.config.tokenizer_path)
        self.tokenizer = AutoTokenizer.from_pretrained(
            self.config.tokenizer_path, trust_remote_code=True)
        
    def default_settings(self):

        return {
            "max_length": 2048, "num_beams": 1, "do_sample": True,
            "top_p": 0.9, "top_k": 1, "temperature": 0.95,
            "repetition_penalty": 1.02
        }
    
    def get_prompt(self, query):
        """
        Get different prompt for different model.

        :param query: list of dict
            [
                {"BOT": "hello"},
                {"HUMAN": "hello, bot"},
                ...
            ]
        :return: prompt string
        """
        raise NotImplementedError(
            "Every model should implement its own `get_prompt` method."
        )
    
    def get_input(self, prompt):
        """
        Get input dict of model.generate.

        :param prompt: str. The prompt string.
        :return: dict. Later it will be passed to ``model.generate``.
        """
        input_dict = self.tokenizer(prompt, return_tensors="pt")
        for key, value in input_dict.items():
            try:
                if torch.cuda.device_count() >= 1:
                    input_dict[key] = value.cuda()
            except AttributeError:
                pass

        return input_dict
    
    def generate(self, input_dict, gen_kwargs):
        """
        Generate a sentence from ``input_dict``

        :param input_dict: dict. It is from ``get_input``.
        :param gen_kwargs: dict. Parameters used for generating.
        :return: None if too long.
        """
        if "max_length" in gen_kwargs and \
            input_dict["input_ids"].shape[1] >= gen_kwargs["max_length"]:
                return None
        from transformers.generation.streamers import TextStreamer
        from threading import Thread
        import threading
        from queue import Queue
        class TextIteratorStreamer(TextStreamer):  
            def __init__(
                self, tokenizer, skip_prompt: bool = False, timeout = None, **decode_kwargs
            ):
                super().__init__(tokenizer, skip_prompt, **decode_kwargs)
                self.text_queue = Queue()
                self.stop_signal = None
                self.timeout = timeout
                self.loack = threading.Lock()

            def on_finalized_text(self, text: str, stream_end: bool = False):
                """Put the new text in the queue. If the stream is ending, also put a stop signal in the queue."""
                self.text_queue.put(text, timeout=self.timeout)
                if stream_end:
                    self.text_queue.put(self.stop_signal, timeout=self.timeout)

            def __iter__(self):
                return self

            def __next__(self):
                if self.loack:
                    value = self.text_queue.get(timeout=self.timeout)
                    if value == self.stop_signal:
                        raise StopIteration()
                    else:
                        return value
        streamer = TextIteratorStreamer(self.tokenizer, skip_prompt=True)
        generation_kwargs = dict(input_dict, streamer=streamer, **gen_kwargs)
        thread = Thread(target=self.model.generate, kwargs=generation_kwargs)
        thread.start()
        
        return streamer
        # return self.model.generate(**input_dict, **gen_kwargs)
    
    def get_response(self, output, input_dict):
        """
        Get models's response of the dialog.
        
        For example, drop the instruction and history of the output. 

        :param output: Output from ``model.generate``.
        :param input_dict: Input returned from ``get_input``.
        :return: str
        """
        response = output.tolist()[0][len(input_dict["input_ids"][0]):]
        response = self.tokenizer.decode(response, skip_special_tokens=True)
        return response

    def process_response(self, response):
        """
        Post process, such as replace some special tokens.
        
        :param response: String decoded by tokenizer.
        :return: str. It will be passed to the frontend as the latest
            reply og the model
        """
        return response
    
    def load_model(self):
        """
        Load model through transformers.
        """
        # mute warning
        trust_remote_code = issubclass(
            self.model_cls, _BaseAutoModelClass
        )
        self.model = self.model_cls.from_pretrained(
            self.model_name, torch_dtype=self.config.dtype,
            device_map="auto", trust_remote_code=trust_remote_code
        )

    def load_from_s3(self):
        """
        Load weights from hdd:s3
        """
        prefix = f"hdd:s3://opennlplab_hdd/models/{self.model_name}/"
        import io
        import json
        from petrel_client.client import Client
        from accelerate import init_empty_weights
        from .utils import load_checkpoint_and_dispatch_from_s3
        
        # get config
        config = AutoConfig.from_pretrained(
            self.model_name, trust_remote_code=True)
        with no_proxy():
            client = Client()
            # get model_index
            model_list = []
            if client.contains(f"{prefix}pytorch_model.bin.index.json"):
                buffer = io.BytesIO()
                buffer.write(client.get(f"{prefix}pytorch_model.bin.index.json"))
                buffer.seek(0)
                model_index = json.load(buffer)
                buffer.close()
                for weight, filename in model_index["weight_map"].items():
                    filepath = f"{prefix}{filename}"
                    if filepath not in model_list:
                        model_list.append(filepath)
            else:
                model_list.append(f"{prefix}pytorch_model.bin")
            
        if torch.cuda.device_count() >= 1:
            with init_empty_weights():
                self.model = self.model_cls._from_config(
                    config=config, torch_dtype=self.config.dtype
                )
            with no_proxy():
                load_checkpoint_and_dispatch_from_s3(
                    self.model, model_list, device_map="auto",
                    no_split_module_classes=self.no_split_module_classes,
                    dtype=self.config.dtype
                )
        else:
            self.model = self.model_cls._from_config(
                config=config, torch_dtype=self.config.dtype
            )
            with no_proxy():
                load_checkpoint_and_dispatch_from_s3(
                    self.model, model_list, device_map=None,
                    no_split_module_classes=self.no_split_module_classes,
                    dtype=self.config.dtype
                )

    @property
    def model_cls(self):
        raise NotImplementedError(
            "Every model should set its own model class."
        )

    @property
    def no_split_module_classes(self):
        return []